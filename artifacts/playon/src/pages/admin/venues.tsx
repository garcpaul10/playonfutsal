import React, { useState } from "react";
import { Redirect } from "wouter";
import { useGetMyProfile } from "@workspace/api-client-react";
import { useAdminPermissions } from "@/hooks/use-admin-permissions";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/components/ui/phone-input";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { useToast } from "@/hooks/use-toast";
import { Mail } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

interface Venue {
  id: number;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  notes: string | null;
  stripeConnectAccountId: string | null;
  stripeConnectOnboardingStatus: string;
}

function connectStatusBadge(status: string) {
  const isOnboarded = status === "onboarded";
  const map: Record<string, string> = {
    none: "bg-gray-100 text-gray-500",
    invited: "bg-blue-100 text-blue-700",
    onboarded: "bg-green-100 text-green-800",
    restricted: "bg-red-100 text-red-700",
  };
  const label = isOnboarded ? "PAYOUT ✓"
    : status === "invited" ? "INVITED"
    : status === "restricted" ? "RESTRICTED"
    : "NOT SET UP";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${map[status] ?? "bg-gray-100 text-gray-700"}`}>
      {label}
    </span>
  );
}

export default function AdminVenues() {
  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const { canManageVenues, canManagePayouts } = useAdminPermissions();
  const { getToken } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [editing, setEditing] = useState<Venue | null>(null);
  const [venueToDelete, setVenueToDelete] = useState<number | null>(null);
  const [newForm, setNewForm] = useState({ name: "", address: "", city: "", state: "KY", zip: "", phone: "", notes: "" });
  const [formError, setFormError] = useState("");

  // Connect invite state
  const [inviteVenue, setInviteVenue] = useState<Venue | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [invitePhone, setInvitePhone] = useState("");

  const connectInviteMut = useMutation({
    mutationFn: async ({ venueId, email, phone }: { venueId: number; email: string; phone?: string }) => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/connect/venues/${venueId}/invite`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ email, phone: phone || undefined }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error ?? "Failed to send invite");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["venues"] });
      qc.invalidateQueries({ queryKey: ["venue-connect-statuses"] });
      toast({ title: "Invite sent", description: "A Stripe Connect onboarding link was sent to the venue." });
      setInviteVenue(null);
      setInviteEmail("");
      setInvitePhone("");
    },
    onError: (e: Error) => toast({ title: "Invite failed", description: e.message, variant: "destructive" }),
  });

  const { data: venues, isLoading } = useQuery<Venue[]>({
    queryKey: ["venues"],
    queryFn: async () => {
      const res = await fetch("/api/venues");
      if (!res.ok) throw new Error("Failed to load venues");
      return res.json();
    },
  });

  type VenueStatus = { venueId: number; queuedPayoutCount: number; onboardingStatus: string };
  const { data: venueStatuses } = useQuery<VenueStatus[]>({
    queryKey: ["venue-connect-statuses"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/connect/venues/all-statuses`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: canManagePayouts,
  });

  const statusByVenueId = new Map<number, VenueStatus>(
    (venueStatuses ?? []).map(s => [s.venueId, s]),
  );

  const authHeader = async () => {
    const token = await getToken();
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!newForm.name.trim()) throw new Error("Name is required");
      const headers = await authHeader();
      const res = await fetch("/api/venues", {
        method: "POST",
        headers,
        body: JSON.stringify({ ...newForm, name: newForm.name.trim() }),
      });
      if (!res.ok) throw new Error("Failed to create venue");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["venues"] });
      setNewForm({ name: "", address: "", city: "", state: "KY", zip: "", phone: "", notes: "" });
      setFormError("");
    },
    onError: (e: Error) => setFormError(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: async (venue: Venue) => {
      const headers = await authHeader();
      const res = await fetch(`/api/venues/${venue.id}`, { method: "PATCH", headers, body: JSON.stringify(venue) });
      if (!res.ok) throw new Error("Failed to update venue");
      return res.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["venues"] }); setEditing(null); },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const headers = await authHeader();
      const res = await fetch(`/api/venues/${id}`, { method: "DELETE", headers });
      if (!res.ok) throw new Error("Failed to delete venue");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["venues"] }),
  });

  if (profileLoading) return <Layout><div className="p-12"><Skeleton className="h-64" /></div></Layout>;
  if (!profile || (profile.role !== "admin" && profile.role !== "staff" && profile.adminLevel !== "super" && profile.adminLevel !== "admin")) return <Redirect to="/dashboard" />;

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold font-sans uppercase tracking-tight text-primary">Venue Management</h1>
            <p className="text-muted-foreground mt-1">Manage PlayOn facility locations</p>
          </div>
          <Button variant="outline" onClick={() => history.back()}>Back to Admin</Button>
        </div>

        {isLoading ? (
          <div className="space-y-4"><Skeleton className="h-32" /></div>
        ) : (
          <div className="space-y-4 mb-10">
            {venues?.map((venue) => (
              <Card key={venue.id}>
                <CardContent className="pt-5">
                  {editing?.id === venue.id ? (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div><Label>Name</Label><Input value={editing.name} onChange={e => setEditing({...editing, name: e.target.value})} /></div>
                        <div><Label>Phone</Label><PhoneInput value={editing.phone ?? ""} onChange={(formatted) => setEditing({...editing, phone: formatted})} /></div>
                      </div>
                      <div><Label>Address</Label><Input value={editing.address ?? ""} onChange={e => setEditing({...editing, address: e.target.value})} /></div>
                      <div className="grid grid-cols-3 gap-3">
                        <div><Label>City</Label><Input value={editing.city ?? ""} onChange={e => setEditing({...editing, city: e.target.value})} /></div>
                        <div><Label>State</Label><Input value={editing.state ?? ""} onChange={e => setEditing({...editing, state: e.target.value})} /></div>
                        <div><Label>ZIP</Label><Input value={editing.zip ?? ""} onChange={e => setEditing({...editing, zip: e.target.value})} /></div>
                      </div>
                      <div><Label>Notes</Label><Input value={editing.notes ?? ""} onChange={e => setEditing({...editing, notes: e.target.value})} /></div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => updateMutation.mutate(editing)} disabled={updateMutation.isPending}>Save</Button>
                        <Button size="sm" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-lg">{venue.name}</p>
                          {connectStatusBadge((venue as any).stripeConnectOnboardingStatus ?? "none")}
                          {canManagePayouts && (statusByVenueId.get(venue.id)?.queuedPayoutCount ?? 0) > 0 && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300">
                              {statusByVenueId.get(venue.id)!.queuedPayoutCount} payout{statusByVenueId.get(venue.id)!.queuedPayoutCount > 1 ? "s" : ""} queued
                            </span>
                          )}
                        </div>
                        {venue.address && <p className="text-sm text-muted-foreground">{venue.address}, {venue.city}, {venue.state} {venue.zip}</p>}
                        {venue.phone && <p className="text-sm">{venue.phone}</p>}
                        {venue.notes && <p className="text-sm mt-1 text-muted-foreground">{venue.notes}</p>}
                      </div>
                      {canManageVenues && (
                        <div className="flex gap-2 flex-shrink-0">
                          {canManagePayouts && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1"
                              onClick={() => { setInviteVenue(venue); setInviteEmail(""); setInvitePhone(""); }}
                            >
                              <Mail className="h-3.5 w-3.5" /> Invite to Payout
                            </Button>
                          )}
                          <Button size="sm" variant="outline" onClick={() => setEditing({...venue})}>Edit</Button>
                          <Button size="sm" variant="destructive" onClick={() => setVenueToDelete(venue.id)}>Delete</Button>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
            {!venues?.length && <p className="text-muted-foreground text-center py-8">No venues configured yet.</p>}
          </div>
        )}

        {canManageVenues && (
          <Card>
            <CardHeader><CardTitle>Add Venue</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {formError && <p className="text-red-600 text-sm">{formError}</p>}
              <div className="grid grid-cols-2 gap-4">
                <div><Label>Name</Label><Input placeholder="Facility Name" value={newForm.name} onChange={e => setNewForm({...newForm, name: e.target.value})} /></div>
                <div><Label>Phone</Label><PhoneInput value={newForm.phone} onChange={(formatted) => setNewForm({...newForm, phone: formatted})} /></div>
              </div>
              <div><Label>Address</Label><Input placeholder="123 Main St" value={newForm.address} onChange={e => setNewForm({...newForm, address: e.target.value})} /></div>
              <div className="grid grid-cols-3 gap-3">
                <div><Label>City</Label><Input value={newForm.city} onChange={e => setNewForm({...newForm, city: e.target.value})} /></div>
                <div><Label>State</Label><Input value={newForm.state} onChange={e => setNewForm({...newForm, state: e.target.value})} /></div>
                <div><Label>ZIP</Label><Input value={newForm.zip} onChange={e => setNewForm({...newForm, zip: e.target.value})} /></div>
              </div>
              <div><Label>Notes</Label><Input placeholder="Optional notes" value={newForm.notes} onChange={e => setNewForm({...newForm, notes: e.target.value})} /></div>
              <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
                {createMutation.isPending ? "Adding..." : "Add Venue"}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Connect Invite Dialog */}
      <Dialog open={inviteVenue !== null} onOpenChange={(open) => { if (!open) { setInviteVenue(null); setInviteEmail(""); setInvitePhone(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite {inviteVenue?.name} to Payout</DialogTitle>
            <DialogDescription>
              Enter the contact email for this facility. We'll send a Stripe Connect onboarding link so they can receive payout splits.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="mb-1 block">Contact Email <span className="text-red-500">*</span></Label>
              <input
                type="email"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="facility@example.com"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
              />
            </div>
            <div>
              <Label className="mb-1 block">Phone (optional — also send via SMS)</Label>
              <PhoneInput value={invitePhone} onChange={setInvitePhone} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteVenue(null)}>Cancel</Button>
            <Button
              disabled={!inviteEmail.trim() || connectInviteMut.isPending}
              onClick={() => {
                if (inviteVenue) {
                  connectInviteMut.mutate({ venueId: inviteVenue.id, email: inviteEmail.trim(), phone: invitePhone || undefined });
                }
              }}
            >
              {connectInviteMut.isPending ? "Sending…" : "Send Invite"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={venueToDelete !== null} onOpenChange={(open) => { if (!open) setVenueToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete venue?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently remove the venue. This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (venueToDelete !== null) { deleteMutation.mutate(venueToDelete); setVenueToDelete(null); } }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
