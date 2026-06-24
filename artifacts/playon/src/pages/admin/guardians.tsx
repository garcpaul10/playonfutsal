import React, { useState } from "react";
import { Redirect } from "wouter";
import { useGetMyProfile } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { format } from "date-fns";
import { ChevronDown, ChevronRight, CheckCircle, XCircle, Clock } from "lucide-react";

interface GuardianRow {
  id: number;
  guardianUserId: number;
  youthUserId: number;
  relationship: string;
  isPrimary: boolean;
  canRegister: boolean;
  canPickup: boolean;
  status: "pending" | "approved" | "rejected";
  notes: string | null;
  createdAt: string;
  guardianFirstName?: string;
  guardianLastName?: string;
  guardianEmail?: string;
  youthFirstName?: string;
  youthLastName?: string;
}

interface GuardianGroup {
  guardianUserId: number;
  guardianName: string;
  guardianEmail: string | undefined;
  children: GuardianRow[];
  pendingCount: number;
}

function statusBadge(status: GuardianRow["status"]) {
  if (status === "approved")
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-green-100 text-green-800 font-medium">
        <CheckCircle className="w-3 h-3" /> Approved
      </span>
    );
  if (status === "rejected")
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-red-100 text-red-800 font-medium">
        <XCircle className="w-3 h-3" /> Rejected
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-yellow-100 text-yellow-800 font-medium">
      <Clock className="w-3 h-3" /> Pending
    </span>
  );
}

function groupByGuardian(rows: GuardianRow[]): GuardianGroup[] {
  const map = new Map<number, GuardianGroup>();
  for (const row of rows) {
    if (!map.has(row.guardianUserId)) {
      map.set(row.guardianUserId, {
        guardianUserId: row.guardianUserId,
        guardianName:
          row.guardianFirstName || row.guardianLastName
            ? `${row.guardianFirstName ?? ""} ${row.guardianLastName ?? ""}`.trim()
            : `User #${row.guardianUserId}`,
        guardianEmail: row.guardianEmail,
        children: [],
        pendingCount: 0,
      });
    }
    const group = map.get(row.guardianUserId)!;
    group.children.push(row);
    if (row.status === "pending") group.pendingCount++;
  }
  return Array.from(map.values());
}

export default function AdminGuardians() {
  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const { data: guardians, isLoading } = useQuery<GuardianRow[]>({
    queryKey: ["guardians-admin"],
    enabled: !profileLoading && (profile?.role === "admin" || profile?.adminLevel === "super" || profile?.adminLevel === "admin"),
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch("/api/guardians", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load guardians");
      return res.json();
    },
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: "approved" | "rejected" }) => {
      const token = await getToken();
      const res = await fetch(`/api/guardians/${id}/status`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["guardians-admin"] });
    },
  });

  const toggleExpand = (guardianUserId: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(guardianUserId)) {
        next.delete(guardianUserId);
      } else {
        next.add(guardianUserId);
      }
      return next;
    });
  };

  if (profileLoading)
    return (
      <Layout>
        <div className="p-12">
          <Skeleton className="h-64" />
        </div>
      </Layout>
    );
  if (!profile || (profile.role !== "admin" && profile.adminLevel !== "super" && profile.adminLevel !== "admin")) return <Redirect to="/dashboard" />;

  const groups = guardians ? groupByGuardian(guardians) : [];

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12 max-w-5xl">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold font-sans uppercase tracking-tight text-primary">
              Guardian Relationships
            </h1>
            <p className="text-muted-foreground mt-1">
              All registered guardian-to-youth account links, grouped by parent
            </p>
          </div>
          <Button variant="outline" onClick={() => history.back()}>
            Back to Admin
          </Button>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {groups.map((group) => {
              const isOpen = expandedIds.has(group.guardianUserId);
              return (
                <Card key={group.guardianUserId} className="overflow-hidden">
                  <button
                    className="w-full text-left"
                    onClick={() => toggleExpand(group.guardianUserId)}
                  >
                    <CardContent className="pt-5 pb-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {isOpen ? (
                            <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                          )}
                          <div>
                            <p className="font-semibold text-base">{group.guardianName}</p>
                            {group.guardianEmail && (
                              <p className="text-sm text-muted-foreground">{group.guardianEmail}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-muted-foreground">
                            {group.children.length}{" "}
                            {group.children.length === 1 ? "child" : "children"}
                          </span>
                          {group.pendingCount > 0 && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800 font-semibold">
                              {group.pendingCount} pending
                            </span>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </button>

                  {isOpen && (
                    <div className="border-t divide-y">
                      {group.children.map((child) => {
                        const childName =
                          child.youthFirstName || child.youthLastName
                            ? `${child.youthFirstName ?? ""} ${child.youthLastName ?? ""}`.trim()
                            : `User #${child.youthUserId}`;
                        const isPending = child.status === "pending";
                        return (
                          <div key={child.id} className="px-6 py-4 flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                <p className="font-medium text-sm">{childName}</p>
                                {statusBadge(child.status)}
                                {child.isPrimary && (
                                  <span className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary font-medium">
                                    Primary
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground capitalize mb-1">
                                {child.relationship}
                              </p>
                              <div className="flex gap-2 flex-wrap">
                                <span
                                  className={`text-xs px-2 py-0.5 rounded ${
                                    child.canRegister
                                      ? "bg-green-100 text-green-800"
                                      : "bg-red-100 text-red-800"
                                  }`}
                                >
                                  {child.canRegister ? "Can register" : "No registration"}
                                </span>
                                <span
                                  className={`text-xs px-2 py-0.5 rounded ${
                                    child.canPickup
                                      ? "bg-green-100 text-green-800"
                                      : "bg-red-100 text-red-800"
                                  }`}
                                >
                                  {child.canPickup ? "Can pickup" : "No pickup"}
                                </span>
                              </div>
                              {child.notes && (
                                <p className="text-xs text-muted-foreground mt-1">{child.notes}</p>
                              )}
                              <p className="text-xs text-muted-foreground mt-1">
                                Linked {format(new Date(child.createdAt), "MMM d, yyyy")}
                              </p>
                            </div>
                            {isPending && (
                              <div className="flex gap-2 shrink-0">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-green-700 border-green-300 hover:bg-green-50"
                                  disabled={updateStatus.isPending}
                                  onClick={() =>
                                    updateStatus.mutate({ id: child.id, status: "approved" })
                                  }
                                >
                                  <CheckCircle className="w-3.5 h-3.5 mr-1" />
                                  Approve
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-red-700 border-red-300 hover:bg-red-50"
                                  disabled={updateStatus.isPending}
                                  onClick={() =>
                                    updateStatus.mutate({ id: child.id, status: "rejected" })
                                  }
                                >
                                  <XCircle className="w-3.5 h-3.5 mr-1" />
                                  Reject
                                </Button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Card>
              );
            })}
            {!groups.length && (
              <p className="text-muted-foreground text-center py-12">
                No guardian relationships on file.
              </p>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
