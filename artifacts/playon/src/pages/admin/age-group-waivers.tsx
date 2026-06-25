import { API_BASE } from "@/lib/api-base";
import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { format } from "date-fns";
import {
  ShieldCheck, Clock, CheckCircle, XCircle, ChevronDown, ChevronRight,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";


interface WaiverRequest {
  id: number;
  playerId: number;
  requestedBy: number;
  ageGroup: string;
  reason: string;
  status: string;
  adminNote: string | null;
  reviewedBy: number | null;
  createdAt: string;
  updatedAt: string;
  player: { id: number; firstName: string | null; lastName: string | null; dateOfBirth: string | null } | null;
  requester: { id: number; firstName: string | null; lastName: string | null; email: string } | null;
}

function statusColor(status: string) {
  if (status === "approved") return "bg-green-500/10 text-green-400 border-green-500/30";
  if (status === "denied") return "bg-red-500/10 text-red-400 border-red-500/30";
  return "bg-amber-500/10 text-amber-400 border-amber-500/30";
}

function StatusIcon({ status }: { status: string }) {
  if (status === "approved") return <CheckCircle className="h-4 w-4 text-green-400" />;
  if (status === "denied") return <XCircle className="h-4 w-4 text-red-400" />;
  return <Clock className="h-4 w-4 text-amber-400" />;
}

function ageInYears(dob: string | null): string {
  if (!dob) return "Unknown";
  const d = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
  return `${age} yrs`;
}

export default function AdminAgeGroupWaivers() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [reviewDialog, setReviewDialog] = useState<WaiverRequest | null>(null);
  const [reviewStatus, setReviewStatus] = useState<"approved" | "denied">("approved");
  const [adminNote, setAdminNote] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data: waivers, isLoading } = useQuery<WaiverRequest[]>({
    queryKey: ["age-group-waivers", statusFilter],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(
        `${API_BASE}/age-group-waivers${statusFilter ? `?status=${statusFilter}` : ""}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) throw new Error("Failed to load waiver requests");
      return res.json();
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ id, status, adminNote }: { id: number; status: string; adminNote: string }) => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/age-group-waivers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status, adminNote: adminNote.trim() || null }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to update waiver");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["age-group-waivers"] });
      setReviewDialog(null);
      setAdminNote("");
      toast({ title: `Waiver ${reviewStatus}`, description: "The waiver request has been updated." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  function openReview(waiver: WaiverRequest, defaultStatus: "approved" | "denied") {
    setReviewDialog(waiver);
    setReviewStatus(defaultStatus);
    setAdminNote("");
  }

  const list = waivers ?? [];

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground tracking-tight flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-teal-400" />
            Age Group Waivers
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Review play-up / play-down requests from guardians
          </p>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {(["pending", "approved", "denied", ""] as const).map((s) => (
          <button
            key={s ?? "all"}
            onClick={() => setStatusFilter(s ?? "")}
            className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
              statusFilter === (s ?? "")
                ? "bg-primary/20 text-primary border-primary/50"
                : "bg-muted/40 text-muted-foreground border-border hover:border-primary/30"
            }`}
          >
            {s === "" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : list.length === 0 ? (
        <Card className="p-10 text-center border-dashed">
          <ShieldCheck className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">
            {statusFilter === "pending" ? "No pending waiver requests." : "No waiver requests found."}
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {list.map((w) => {
            const isExpanded = expandedId === w.id;
            const playerName = w.player
              ? `${w.player.firstName ?? ""} ${w.player.lastName ?? ""}`.trim() || `Player #${w.playerId}`
              : `Player #${w.playerId}`;
            const requesterName = w.requester
              ? `${w.requester.firstName ?? ""} ${w.requester.lastName ?? ""}`.trim() || w.requester.email
              : `User #${w.requestedBy}`;

            return (
              <Card key={w.id} className="overflow-hidden">
                <button
                  className="w-full p-4 flex items-center gap-3 text-left hover:bg-muted/30 transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : w.id)}
                >
                  <StatusIcon status={w.status} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-foreground">{playerName}</span>
                      <span className="text-muted-foreground text-xs">→</span>
                      <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded uppercase">{w.ageGroup}</span>
                      {w.player?.dateOfBirth && (
                        <span className="text-xs text-muted-foreground">
                          ({ageInYears(w.player.dateOfBirth)} old)
                        </span>
                      )}
                      <span className={`ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full border ${statusColor(w.status)}`}>
                        {w.status}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Requested by {requesterName} · {format(new Date(w.createdAt), "MMM d, yyyy")}
                    </p>
                  </div>
                  {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
                </button>

                {isExpanded && (
                  <div className="border-t border-border px-4 pb-4 pt-3 space-y-3 bg-muted/10">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Reason from guardian</p>
                      <p className="text-sm text-foreground">{w.reason}</p>
                    </div>
                    {w.adminNote && (
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Admin note</p>
                        <p className="text-sm text-foreground">{w.adminNote}</p>
                      </div>
                    )}
                    {w.status === "pending" && (
                      <div className="flex gap-2 pt-1">
                        <Button size="sm" className="bg-green-600 hover:bg-green-500 text-white" onClick={() => openReview(w, "approved")}>
                          <CheckCircle className="h-3.5 w-3.5 mr-1.5" />
                          Approve
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => openReview(w, "denied")}>
                          <XCircle className="h-3.5 w-3.5 mr-1.5" />
                          Deny
                        </Button>
                      </div>
                    )}
                    {w.status !== "pending" && (
                      <Button size="sm" variant="outline" onClick={() => openReview(w, w.status === "approved" ? "denied" : "approved")}>
                        Change Decision
                      </Button>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!reviewDialog} onOpenChange={() => { setReviewDialog(null); setAdminNote(""); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {reviewStatus === "approved" ? "Approve" : "Deny"} Waiver Request
            </DialogTitle>
          </DialogHeader>
          {reviewDialog && (
            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">
                You are {reviewStatus === "approved" ? "approving" : "denying"} the waiver for{" "}
                <strong className="text-foreground">
                  {reviewDialog.player
                    ? `${reviewDialog.player.firstName ?? ""} ${reviewDialog.player.lastName ?? ""}`.trim()
                    : `Player #${reviewDialog.playerId}`}
                </strong>{" "}
                to play in{" "}
                <strong className="font-mono uppercase text-foreground">{reviewDialog.ageGroup}</strong>.
              </p>

              <div className="space-y-1.5">
                <Label htmlFor="review-status">Decision</Label>
                <Select value={reviewStatus} onValueChange={(v) => setReviewStatus(v as "approved" | "denied")}>
                  <SelectTrigger id="review-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="approved">Approve</SelectItem>
                    <SelectItem value="denied">Deny</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="admin-note">
                  Admin note <span className="text-muted-foreground text-xs">(optional — visible to guardian)</span>
                </Label>
                <Textarea
                  id="admin-note"
                  value={adminNote}
                  onChange={(e) => setAdminNote(e.target.value)}
                  placeholder={reviewStatus === "denied" ? "Reason for denial…" : "Any notes for the guardian…"}
                  rows={3}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setReviewDialog(null); setAdminNote(""); }} disabled={reviewMutation.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => reviewDialog && reviewMutation.mutate({ id: reviewDialog.id, status: reviewStatus, adminNote })}
              disabled={reviewMutation.isPending}
              className={reviewStatus === "approved" ? "bg-green-600 hover:bg-green-500 text-white" : ""}
              variant={reviewStatus === "denied" ? "destructive" : "default"}
            >
              {reviewMutation.isPending ? "Saving…" : reviewStatus === "approved" ? "Approve" : "Deny"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
