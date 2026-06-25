import { API_BASE } from "@/lib/api-base";
import { useState } from "react";
import { useAuth } from "@clerk/react";
import { useGetMyProfile } from "@workspace/api-client-react";
import { Redirect } from "wouter";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, AlertTriangle, CheckCircle2, XCircle, Clock } from "lucide-react";


interface VenueInsurance {
  id: number;
  name: string;
  insuranceProvider: string | null;
  insurancePolicyNumber: string | null;
  insuranceExpiry: string | null;
  insuranceBadge: "ok" | "warning" | "expired" | "unknown";
  insuranceExpiryDays: number | null;
}

interface StaffClearance {
  profileId: number;
  userId: number;
  userFirstName: string | null;
  userLastName: string | null;
  title: string | null;
  backgroundCheckStatus: string;
  backgroundCheckDate: string | null;
  backgroundCheckExpiry: string | null;
  certificationExpiry: string | null;
  certifications: string[];
  isActive: boolean;
  backgroundCheckBadge: "ok" | "warning" | "expired" | "unknown";
  certificationBadge: "ok" | "warning" | "expired" | "unknown";
}

function BadgeIcon({ badge }: { badge: string }) {
  if (badge === "ok") return <CheckCircle2 className="h-4 w-4 text-green-500" />;
  if (badge === "warning") return <Clock className="h-4 w-4 text-amber-500" />;
  if (badge === "expired") return <XCircle className="h-4 w-4 text-destructive" />;
  return <AlertTriangle className="h-4 w-4 text-muted-foreground" />;
}

function StatusBadge({ badge, days }: { badge: string; days: number | null }) {
  const label = badge === "ok" ? "OK" : badge === "warning" ? `Expires in ${days}d` : badge === "expired" ? `Expired ${Math.abs(days ?? 0)}d ago` : "Not set";
  const cls = badge === "ok" ? "bg-green-600" : badge === "warning" ? "bg-amber-600" : badge === "expired" ? "bg-red-700" : "bg-gray-600";
  return <Badge className={`text-xs text-white ${cls}`}>{label}</Badge>;
}

export default function AdminInsurance() {
  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const { getToken } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [editVenue, setEditVenue] = useState<VenueInsurance | null>(null);
  const [editStaff, setEditStaff] = useState<StaffClearance | null>(null);
  const [venueForm, setVenueForm] = useState({ insuranceProvider: "", insurancePolicyNumber: "", insuranceExpiry: "" });
  const [staffForm, setStaffForm] = useState({ backgroundCheckStatus: "", backgroundCheckDate: "", backgroundCheckExpiry: "", certificationExpiry: "" });

  const { data, isLoading } = useQuery<{ venues: VenueInsurance[]; staff: StaffClearance[]; warnings: any[] }>({
    queryKey: ["insurance"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/insurance`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!profile,
  });

  const saveVenueInsurance = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/venues/${editVenue!.id}/insurance`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(venueForm),
      });
      if (!res.ok) throw new Error("Failed to save");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["insurance"] }); setEditVenue(null); toast({ title: "Insurance info updated" }); },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  const saveStaffClearance = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/staff-profiles/${editStaff!.profileId}/clearance`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(staffForm),
      });
      if (!res.ok) throw new Error("Failed to save");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["insurance"] }); setEditStaff(null); toast({ title: "Clearance info updated" }); },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  const isAdmin = profile?.role === "admin" || profile?.adminLevel === "super" || profile?.adminLevel === "admin";
  if (profileLoading) return <Layout><div className="p-12"><Skeleton className="h-96" /></div></Layout>;
  if (!isAdmin) return <Redirect to="/dashboard" />;

  const venues = data?.venues ?? [];
  const staff = data?.staff ?? [];
  const warnings = data?.warnings ?? [];

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12">
        <a href="/admin" className="text-sm text-muted-foreground hover:text-foreground mb-4 block">← Admin</a>
        <div className="flex items-center gap-3 mb-2">
          <ShieldCheck className="h-7 w-7 text-primary" />
          <h1 className="text-3xl font-bold font-sans uppercase tracking-tight text-primary">Insurance & Clearances</h1>
        </div>
        <p className="text-muted-foreground mb-8">Track facility insurance and coach background-check / certification expiry dates.</p>

        {warnings.length > 0 && (
          <div className="mb-6 rounded-md bg-amber-500/10 border border-amber-500/30 px-4 py-3 flex gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-sm">Action required — {warnings.length} item(s) expiring or expired</p>
              <p className="text-sm text-muted-foreground mt-0.5">Review the items below and update before expiry to maintain coverage.</p>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-4">{[1,2,3].map((i) => <Skeleton key={i} className="h-24" />)}</div>
        ) : (
          <div className="space-y-8">
            <div>
              <h2 className="text-lg font-semibold mb-3">Facility insurance</h2>
              <div className="space-y-3">
                {venues.length === 0 && <p className="text-muted-foreground text-sm">No venues. Add a venue first.</p>}
                {venues.map((v) => (
                  <Card key={v.id}>
                    <CardContent className="pt-4 flex items-center justify-between gap-4">
                      <div>
                        <p className="font-medium">{v.name}</p>
                        <p className="text-sm text-muted-foreground mt-0.5">
                          {v.insuranceProvider ?? "No provider set"} · {v.insurancePolicyNumber ?? "No policy number"} · Expires: {v.insuranceExpiry ?? "Not set"}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <BadgeIcon badge={v.insuranceBadge} />
                        <StatusBadge badge={v.insuranceBadge} days={v.insuranceExpiryDays} />
                        <Button size="sm" variant="outline" onClick={() => {
                          setEditVenue(v);
                          setVenueForm({ insuranceProvider: v.insuranceProvider ?? "", insurancePolicyNumber: v.insurancePolicyNumber ?? "", insuranceExpiry: v.insuranceExpiry ?? "" });
                        }}>Edit</Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>

            <div>
              <h2 className="text-lg font-semibold mb-3">Coach & staff clearances</h2>
              <div className="space-y-3">
                {staff.filter((s) => s.isActive).length === 0 && <p className="text-muted-foreground text-sm">No active staff profiles.</p>}
                {staff.filter((s) => s.isActive).map((s) => (
                  <Card key={s.profileId}>
                    <CardContent className="pt-4 flex items-center justify-between gap-4">
                      <div>
                        <p className="font-medium">{s.userFirstName} {s.userLastName} {s.title && <span className="text-muted-foreground text-sm">· {s.title}</span>}</p>
                        <div className="flex gap-4 mt-1 text-sm text-muted-foreground">
                          <span>Background check: {s.backgroundCheckStatus} {s.backgroundCheckExpiry ? `· expires ${s.backgroundCheckExpiry}` : ""}</span>
                          {s.certificationExpiry && <span>Certifications expire: {s.certificationExpiry}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex flex-col gap-1 items-end">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-muted-foreground">BG check</span>
                            <BadgeIcon badge={s.backgroundCheckBadge} />
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-muted-foreground">Certs</span>
                            <BadgeIcon badge={s.certificationBadge} />
                          </div>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => {
                          setEditStaff(s);
                          setStaffForm({ backgroundCheckStatus: s.backgroundCheckStatus, backgroundCheckDate: s.backgroundCheckDate ?? "", backgroundCheckExpiry: s.backgroundCheckExpiry ?? "", certificationExpiry: s.certificationExpiry ?? "" });
                        }}>Edit</Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <Dialog open={!!editVenue} onOpenChange={() => setEditVenue(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Edit insurance — {editVenue?.name}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Provider</Label><Input value={venueForm.insuranceProvider} onChange={(e) => setVenueForm({ ...venueForm, insuranceProvider: e.target.value })} placeholder="e.g. State Farm" /></div>
            <div><Label>Policy number</Label><Input value={venueForm.insurancePolicyNumber} onChange={(e) => setVenueForm({ ...venueForm, insurancePolicyNumber: e.target.value })} /></div>
            <div><Label>Expiry date</Label><Input type="date" value={venueForm.insuranceExpiry} onChange={(e) => setVenueForm({ ...venueForm, insuranceExpiry: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditVenue(null)}>Cancel</Button>
            <Button onClick={() => saveVenueInsurance.mutate()} disabled={saveVenueInsurance.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editStaff} onOpenChange={() => setEditStaff(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Edit clearances — {editStaff?.userFirstName} {editStaff?.userLastName}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Background check status</Label>
              <select className="w-full rounded-md border bg-background px-3 py-2 text-sm mt-1" value={staffForm.backgroundCheckStatus} onChange={(e) => setStaffForm({ ...staffForm, backgroundCheckStatus: e.target.value })}>
                <option value="pending">Pending</option>
                <option value="cleared">Cleared</option>
                <option value="failed">Failed</option>
                <option value="expired">Expired</option>
              </select>
            </div>
            <div><Label>Background check date</Label><Input type="date" value={staffForm.backgroundCheckDate} onChange={(e) => setStaffForm({ ...staffForm, backgroundCheckDate: e.target.value })} /></div>
            <div><Label>Background check expiry</Label><Input type="date" value={staffForm.backgroundCheckExpiry} onChange={(e) => setStaffForm({ ...staffForm, backgroundCheckExpiry: e.target.value })} /></div>
            <div><Label>Certification expiry</Label><Input type="date" value={staffForm.certificationExpiry} onChange={(e) => setStaffForm({ ...staffForm, certificationExpiry: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditStaff(null)}>Cancel</Button>
            <Button onClick={() => saveStaffClearance.mutate()} disabled={saveStaffClearance.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
