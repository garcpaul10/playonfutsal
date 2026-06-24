import { useState } from "react";
import { useAuth } from "@clerk/react";
import { useGetMyProfile } from "@workspace/api-client-react";
import { Redirect } from "wouter";
import { Layout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toEasternISOString } from "@/lib/timezone";
import { FileWarning, Plus, ChevronDown, ChevronUp, MessageSquare } from "lucide-react";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

interface IncidentReport {
  id: number;
  entityType: string | null;
  entityId: number | null;
  incidentType: string;
  severity: string;
  title: string;
  description: string;
  actionTaken: string | null;
  status: string;
  currentStatus: string;
  isConfidential: boolean;
  occurredAt: string | null;
  followUpRequired: boolean;
  createdAt: string;
  latestReview: { id: number; status: string; notes: string | null; createdAt: string } | null;
}

const SEVERITY_COLORS: Record<string, string> = {
  low: "bg-blue-600",
  medium: "bg-amber-600",
  high: "bg-orange-600",
  critical: "bg-red-700",
};

export default function AdminIncidentReports() {
  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const { getToken } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [statusFilter, setStatusFilter] = useState("");
  const [showDialog, setShowDialog] = useState(false);
  const [reviewDialogId, setReviewDialogId] = useState<number | null>(null);
  const [reviewForm, setReviewForm] = useState({ status: "under_review", notes: "" });
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [form, setForm] = useState({
    title: "", description: "", incidentType: "general", severity: "low",
    entityType: "", entityId: "", occurredAt: "", actionTaken: "",
    followUpRequired: false, isConfidential: false,
  });

  const { data: reports = [], isLoading } = useQuery<IncidentReport[]>({
    queryKey: ["incident-reports", statusFilter],
    queryFn: async () => {
      const token = await getToken();
      const params = new URLSearchParams({ limit: "100" });
      if (statusFilter) params.set("status", statusFilter);
      const res = await fetch(`${API_BASE}/admin/incident-reports?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    enabled: !!profile,
  });

  const fileReport = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/incident-reports`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          entityId: form.entityId ? parseInt(form.entityId) : undefined,
          entityType: form.entityType || undefined,
          occurredAt: form.occurredAt ? toEasternISOString(form.occurredAt) : undefined,
          actionTaken: form.actionTaken || undefined,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Failed");
      return d;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["incident-reports"] });
      setShowDialog(false);
      setForm({ title: "", description: "", incidentType: "general", severity: "low", entityType: "", entityId: "", occurredAt: "", actionTaken: "", followUpRequired: false, isConfidential: false });
      toast({ title: "Incident report filed", description: "Report is now on record. Core details are locked — use the Review button to track status." });
    },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  const addReview = useMutation({
    mutationFn: async ({ reportId, status, notes }: { reportId: number; status: string; notes: string }) => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/incident-reports/${reportId}/reviews`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ status, notes: notes || undefined }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Failed");
      return d;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["incident-reports"] });
      setReviewDialogId(null);
      setReviewForm({ status: "under_review", notes: "" });
      toast({ title: "Review added", description: "Status updated — original report unchanged." });
    },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  const isAdmin = profile?.role === "admin" || profile?.role === "staff" || profile?.adminLevel === "super" || profile?.adminLevel === "admin";
  if (profileLoading) return <Layout><div className="p-12"><Skeleton className="h-96" /></div></Layout>;
  if (!isAdmin) return <Redirect to="/dashboard" />;

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12">
        <a href="/admin" className="text-sm text-muted-foreground hover:text-foreground mb-4 block">← Admin</a>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <FileWarning className="h-7 w-7 text-primary" />
            <h1 className="text-3xl font-bold font-sans uppercase tracking-tight text-primary">Incident Reports</h1>
          </div>
          <Button onClick={() => setShowDialog(true)} className="gap-2"><Plus className="h-4 w-4" /> File report</Button>
        </div>
        <p className="text-muted-foreground mb-2">Injury and incident reports filed by staff and admins. Core report details are <strong>immutable</strong> — status tracking is handled via separate append-only reviews.</p>

        <div className="rounded-md bg-muted/40 border px-3 py-2 text-xs text-muted-foreground mb-6">
          Immutability note: Once a report is filed, its title, description, and facts cannot be edited. Use the <strong>Review</strong> button to record status changes (under review → resolved → closed). All reviews are append-only entries stored separately.
        </div>

        <Card className="mb-6">
          <CardContent className="pt-4">
            <div className="flex gap-4">
              <div className="space-y-1">
                <Label>Status filter</Label>
                <select className="rounded-md border bg-background px-3 py-2 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="">All statuses</option>
                  <option value="open">Open</option>
                  <option value="under_review">Under review</option>
                  <option value="resolved">Resolved</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="space-y-3">{[1,2,3].map((i) => <Skeleton key={i} className="h-20" />)}</div>
        ) : reports.length === 0 ? (
          <Card><CardContent className="py-12 text-center text-muted-foreground">No incident reports found.</CardContent></Card>
        ) : (
          <div className="space-y-3">
            {reports.map((r) => (
              <Card key={r.id}>
                <div
                  className="px-4 py-3 flex items-start justify-between gap-4 cursor-pointer hover:bg-muted/20"
                  onClick={() => setExpanded((prev) => { const s = new Set(prev); s.has(r.id) ? s.delete(r.id) : s.add(r.id); return s; })}
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <Badge className={`text-xs text-white flex-shrink-0 ${SEVERITY_COLORS[r.severity] ?? "bg-gray-600"}`}>{r.severity}</Badge>
                    <Badge variant="secondary" className="text-xs flex-shrink-0">{r.currentStatus.replace("_", " ")}</Badge>
                    <span className="font-medium text-sm truncate">{r.title}</span>
                    {r.isConfidential && <Badge variant="outline" className="text-xs flex-shrink-0">confidential</Badge>}
                    {r.followUpRequired && <Badge variant="destructive" className="text-xs flex-shrink-0">follow-up</Badge>}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground flex-shrink-0">
                    {r.occurredAt && <span>{format(new Date(r.occurredAt), "MMM d")}</span>}
                    {expanded.has(r.id) ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </div>
                </div>
                {expanded.has(r.id) && (
                  <div className="px-4 pb-4 border-t pt-3 space-y-3">
                    <p className="text-sm">{r.description}</p>
                    {r.actionTaken && (
                      <p className="text-sm text-muted-foreground"><span className="font-medium">Action taken at filing:</span> {r.actionTaken}</p>
                    )}
                    {r.latestReview && (
                      <div className="rounded-md bg-muted/30 border px-3 py-2 text-xs">
                        <span className="font-medium">Latest review:</span> {r.latestReview.status} — {r.latestReview.notes ?? "no notes"} <span className="text-muted-foreground">({format(new Date(r.latestReview.createdAt), "MMM d, h:mm a")})</span>
                      </div>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={(e) => { e.stopPropagation(); setReviewDialogId(r.id); setReviewForm({ status: "under_review", notes: "" }); }}
                    >
                      <MessageSquare className="h-3.5 w-3.5" /> Add review
                    </Button>
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* File report dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>File incident report</DialogTitle>
            <DialogDescription>Reports are immutable after filing. All staff/admin can view. Status changes use the Review system.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
            <div>
              <Label>Title <span className="text-destructive">*</span></Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Brief description of the incident" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Type</Label>
                <select className="w-full rounded-md border bg-background px-3 py-2 text-sm mt-1" value={form.incidentType} onChange={(e) => setForm({ ...form, incidentType: e.target.value })}>
                  <option value="general">General</option>
                  <option value="injury">Injury</option>
                  <option value="misconduct">Misconduct</option>
                  <option value="property_damage">Property damage</option>
                  <option value="medical">Medical</option>
                </select>
              </div>
              <div>
                <Label>Severity</Label>
                <select className="w-full rounded-md border bg-background px-3 py-2 text-sm mt-1" value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
            </div>
            <div>
              <Label>Description <span className="text-destructive">*</span></Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} placeholder="What happened? Who was involved? What was the outcome?" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Related entity type</Label>
                <select className="w-full rounded-md border bg-background px-3 py-2 text-sm mt-1" value={form.entityType} onChange={(e) => setForm({ ...form, entityType: e.target.value })}>
                  <option value="">— none —</option>
                  <option value="fixture">Fixture</option>
                  <option value="league">League</option>
                  <option value="camp">Camp</option>
                  <option value="tournament">Tournament</option>
                  <option value="drop_in">Drop-in</option>
                </select>
              </div>
              <div>
                <Label>Related entity ID</Label>
                <Input type="number" value={form.entityId} onChange={(e) => setForm({ ...form, entityId: e.target.value })} placeholder="e.g. 42" />
              </div>
            </div>
            <div>
              <Label>Occurred at</Label>
              <Input type="datetime-local" value={form.occurredAt} onChange={(e) => setForm({ ...form, occurredAt: e.target.value })} />
            </div>
            <div>
              <Label>Initial action taken</Label>
              <Input value={form.actionTaken} onChange={(e) => setForm({ ...form, actionTaken: e.target.value })} placeholder="e.g. Player removed from game, ice applied" />
            </div>
            <div className="flex gap-6">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={form.followUpRequired} onChange={(e) => setForm({ ...form, followUpRequired: e.target.checked })} />
                Follow-up required
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={form.isConfidential} onChange={(e) => setForm({ ...form, isConfidential: e.target.checked })} />
                Confidential
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button onClick={() => fileReport.mutate()} disabled={fileReport.isPending || !form.title.trim() || !form.description.trim()}>
              {fileReport.isPending ? "Filing…" : "File report"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add review dialog */}
      <Dialog open={reviewDialogId !== null} onOpenChange={() => setReviewDialogId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add review</DialogTitle>
            <DialogDescription>This records a new status entry without modifying the original report. All reviews are permanent.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>New status <span className="text-destructive">*</span></Label>
              <select className="w-full rounded-md border bg-background px-3 py-2 text-sm mt-1" value={reviewForm.status} onChange={(e) => setReviewForm({ ...reviewForm, status: e.target.value })}>
                <option value="under_review">Under review</option>
                <option value="resolved">Resolved</option>
                <option value="closed">Closed</option>
                <option value="escalated">Escalated</option>
              </select>
            </div>
            <div>
              <Label>Notes <span className="text-muted-foreground text-xs">(what action was taken)</span></Label>
              <Textarea value={reviewForm.notes} onChange={(e) => setReviewForm({ ...reviewForm, notes: e.target.value })} rows={3} placeholder="Describe the resolution or next steps…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewDialogId(null)}>Cancel</Button>
            <Button
              onClick={() => addReview.mutate({ reportId: reviewDialogId!, status: reviewForm.status, notes: reviewForm.notes })}
              disabled={addReview.isPending}
            >
              {addReview.isPending ? "Adding…" : "Add review"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
