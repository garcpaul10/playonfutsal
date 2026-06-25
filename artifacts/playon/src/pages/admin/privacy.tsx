import { API_BASE } from "@/lib/api-base";
import { useState } from "react";
import { useAuth } from "@clerk/react";
import { useGetMyProfile } from "@workspace/api-client-react";
import { Redirect } from "wouter";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { Shield, Download, Trash2, Search } from "lucide-react";


interface YouthPlayer {
  id: number;
  clerkId: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  dateOfBirth: string | null;
  role: string;
  createdAt: string;
}

export default function AdminPrivacy() {
  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const { getToken } = useAuth();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [confirmAnonymize, setConfirmAnonymize] = useState<YouthPlayer | null>(null);

  const { data: players = [], isLoading } = useQuery<YouthPlayer[]>({
    queryKey: ["privacy-youth-players"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/privacy/youth-players`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!profile && (profile.role === "admin" || profile.adminLevel === "super" || profile.adminLevel === "admin"),
  });

  const exportUser = useMutation({
    mutationFn: async (userId: number) => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/privacy/export/${userId}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `player_export_${data.user.id}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "PII exported", description: "JSON file downloaded." });
    },
    onError: () => toast({ title: "Export failed", variant: "destructive" }),
  });

  const anonymizeUser = useMutation({
    mutationFn: async (userId: number) => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/privacy/anonymize/${userId}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Guardian data deletion request" }),
      });
      if (!res.ok) throw new Error("Failed");
    },
    onSuccess: () => {
      setConfirmAnonymize(null);
      toast({ title: "User PII anonymized", description: "All personal information has been removed." });
    },
    onError: () => toast({ title: "Anonymization failed", variant: "destructive" }),
  });

  const isAdmin = profile?.role === "admin" || profile?.adminLevel === "super" || profile?.adminLevel === "admin";
  if (profileLoading) return <Layout><div className="p-12"><Skeleton className="h-96" /></div></Layout>;
  if (!isAdmin) return <Redirect to="/dashboard" />;

  const filtered = players.filter((p) => {
    const q = search.toLowerCase();
    return (
      !q ||
      p.firstName?.toLowerCase().includes(q) ||
      p.lastName?.toLowerCase().includes(q) ||
      p.email.toLowerCase().includes(q)
    );
  });

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12">
        <a href="/admin" className="text-sm text-muted-foreground hover:text-foreground mb-4 block">← Admin</a>
        <div className="flex items-center gap-3 mb-2">
          <Shield className="h-7 w-7 text-primary" />
          <h1 className="text-3xl font-bold font-sans uppercase tracking-tight text-primary">Data Privacy</h1>
        </div>
        <p className="text-muted-foreground mb-8">
          Export or anonymize youth player PII on guardian request. All access is logged in the audit trail.
        </p>

        <Card className="mb-6">
          <CardContent className="pt-4">
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search by name or email…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="space-y-3">{[1,2,3,4].map((i) => <Skeleton key={i} className="h-16" />)}</div>
        ) : filtered.length === 0 ? (
          <Card><CardContent className="py-12 text-center text-muted-foreground">No players found.</CardContent></Card>
        ) : (
          <div className="space-y-2">
            {filtered.map((p) => (
              <Card key={p.id}>
                <CardContent className="pt-3 pb-3 flex items-center justify-between gap-4">
                  <div>
                    <p className="font-medium text-sm">
                      {p.firstName && p.lastName ? `${p.firstName} ${p.lastName}` : <span className="text-muted-foreground italic">[anonymized]</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {p.email} · DOB: {p.dateOfBirth ?? "—"} · joined {format(new Date(p.createdAt), "MMM yyyy")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={() => exportUser.mutate(p.id)}
                      disabled={exportUser.isPending}
                    >
                      <Download className="h-3.5 w-3.5" /> Export PII
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10"
                      onClick={() => setConfirmAnonymize(p)}
                      disabled={p.firstName === "[ANONYMIZED]"}
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Anonymize
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={!!confirmAnonymize} onOpenChange={() => setConfirmAnonymize(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Anonymize player PII</DialogTitle>
            <DialogDescription>
              This will permanently replace all personal information for{" "}
              <strong>{confirmAnonymize?.firstName} {confirmAnonymize?.lastName}</strong> with anonymized values.
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-sm">
            Name, email, phone, and date of birth will be removed. Registration history and payment records are retained for accounting purposes.
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAnonymize(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => anonymizeUser.mutate(confirmAnonymize!.id)}
              disabled={anonymizeUser.isPending}
            >
              {anonymizeUser.isPending ? "Anonymizing…" : "Anonymize permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
