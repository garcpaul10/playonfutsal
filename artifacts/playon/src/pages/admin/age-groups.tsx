import { API_BASE } from "@/lib/api-base";
import React, { useState } from "react";
import { Redirect } from "wouter";
import { useGetMyProfile } from "@workspace/api-client-react";
import { useAdminPermissions } from "@/hooks/use-admin-permissions";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { Pencil } from "lucide-react";

interface AgeGroup {
  id: number;
  label: string;
  minAge: number;
  maxAge: number | null;
  division: string;
  displayOrder: number;
}

interface AgeGroupMapping {
  id: number;
  ageGroupId: number;
  defaultCourtId: number | null;
  defaultFormat: string;
  defaultDurationMinutes: number;
  timebandStart: string | null;
  timebandEnd: string | null;
  notes: string | null;
}

interface Court { id: number; name: string; }

export default function AdminAgeGroups() {
  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const [newForm, setNewForm] = useState({ label: "", minAge: "", maxAge: "", division: "boy", displayOrder: "10" });
  const [formError, setFormError] = useState("");
  const [editTarget, setEditTarget] = useState<AgeGroup | null>(null);
  const [editForm, setEditForm] = useState({ label: "", minAge: "", maxAge: "", division: "youth", displayOrder: "10" });
  const [ageGroupToDelete, setAgeGroupToDelete] = useState<{ id: number; label: string } | null>(null);

  const authHeader = async () => {
    const token = await getToken();
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  };

  const { data: ageGroups, isLoading: agLoading } = useQuery<AgeGroup[]>({
    queryKey: ["age-groups"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/age-groups`);
      if (!res.ok) throw new Error("Failed to load age groups");
      return res.json();
    },
  });

  const { data: mappings } = useQuery<AgeGroupMapping[]>({
    queryKey: ["age-group-mappings"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/age-group-mappings`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: courts } = useQuery<Court[]>({
    queryKey: ["courts"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/courts`);
      if (!res.ok) throw new Error("Failed to load courts");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!newForm.label.trim()) throw new Error("Label is required");
      const headers = await authHeader();
      const res = await fetch(`${API_BASE}/age-groups`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          label: newForm.label.trim(),
          minAge: parseInt(newForm.minAge) || 0,
          maxAge: newForm.maxAge ? parseInt(newForm.maxAge) : null,
          division: newForm.division,
          displayOrder: parseInt(newForm.displayOrder) || 10,
        }),
      });
      if (!res.ok) throw new Error("Failed to create age group");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["age-groups"] });
      setNewForm({ label: "", minAge: "", maxAge: "", division: "boy", displayOrder: "10" });
      setFormError("");
    },
    onError: (e: Error) => setFormError(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editTarget) return;
      const headers = await authHeader();
      const res = await fetch(`${API_BASE}/age-groups/${editTarget.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          label: editForm.label.trim(),
          minAge: parseInt(editForm.minAge) || 0,
          maxAge: editForm.maxAge ? parseInt(editForm.maxAge) : null,
          division: editForm.division,
          displayOrder: parseInt(editForm.displayOrder) || 10,
        }),
      });
      if (!res.ok) throw new Error("Failed to update age group");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["age-groups"] });
      setEditTarget(null);
    },
    onError: (e: Error) => setFormError(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const headers = await authHeader();
      const res = await fetch(`${API_BASE}/age-groups/${id}`, { method: "DELETE", headers });
      if (!res.ok) throw new Error("Failed to delete age group");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["age-groups"] }),
  });

  function openEdit(ag: AgeGroup) {
    setEditTarget(ag);
    setEditForm({
      label: ag.label,
      minAge: String(ag.minAge),
      maxAge: ag.maxAge !== null ? String(ag.maxAge) : "",
      division: ag.division,
      displayOrder: String(ag.displayOrder),
    });
  }

  const getMappingForGroup = (id: number) => mappings?.find(m => m.ageGroupId === id);
  const getCourtName = (id: number | null) => id ? courts?.find(c => c.id === id)?.name ?? `Court ${id}` : "None";

  const { canManageAgeGroups } = useAdminPermissions();

  if (profileLoading) return <Layout><div className="p-12"><Skeleton className="h-64" /></div></Layout>;
  if (!profile || (profile.role !== "admin" && profile.role !== "staff" && profile.adminLevel !== "super" && profile.adminLevel !== "admin")) return <Redirect to="/dashboard" />;

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold font-sans uppercase tracking-tight text-primary">Age Group Management</h1>
            <p className="text-muted-foreground mt-1">Configure divisions, formats, and court defaults</p>
          </div>
          <Button variant="outline" onClick={() => history.back()}>Back to Admin</Button>
        </div>

        {agLoading ? (
          <div className="space-y-2">{[1,2,3,4].map(i => <Skeleton key={i} className="h-20" />)}</div>
        ) : (
          <div className="space-y-3 mb-10">
            {ageGroups?.sort((a, b) => a.displayOrder - b.displayOrder).map((ag) => {
              const mapping = getMappingForGroup(ag.id);
              const isEditing = editTarget?.id === ag.id;
              return (
                <Card key={ag.id}>
                  <CardContent className="pt-4 pb-4">
                    {isEditing ? (
                      <div className="space-y-3">
                        <p className="text-sm font-medium">Edit Age Group</p>
                        <div className="grid grid-cols-2 gap-3">
                          <div><Label>Label</Label><Input value={editForm.label} onChange={e => setEditForm({...editForm, label: e.target.value})} /></div>
                          <div><Label>Division</Label>
                            <select className="w-full border rounded px-3 py-2 text-sm" value={editForm.division} onChange={e => setEditForm({...editForm, division: e.target.value})}>
                              <option value="boy">Boys</option>
                              <option value="girl">Girls</option>
                              <option value="men">Men</option>
                              <option value="women">Women</option>
                              <option value="coed">Coed</option>
                              <option value="youth">Youth (legacy)</option>
                              <option value="adult">Adult (legacy)</option>
                            </select>
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                          <div><Label>Min Age</Label><Input type="number" value={editForm.minAge} onChange={e => setEditForm({...editForm, minAge: e.target.value})} /></div>
                          <div><Label>Max Age</Label><Input type="number" placeholder="blank = open" value={editForm.maxAge} onChange={e => setEditForm({...editForm, maxAge: e.target.value})} /></div>
                          <div><Label>Display Order</Label><Input type="number" value={editForm.displayOrder} onChange={e => setEditForm({...editForm, displayOrder: e.target.value})} /></div>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}>
                            {updateMutation.isPending ? "Saving..." : "Save"}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setEditTarget(null)}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-3">
                            <span className="font-semibold text-lg">{ag.label}</span>
                            <span className="text-xs bg-secondary text-secondary-foreground px-2 py-0.5 rounded uppercase">{ag.division}</span>
                          </div>
                          <p className="text-sm text-muted-foreground mt-0.5">
                            Ages {ag.minAge}{ag.maxAge ? `–${ag.maxAge}` : "+"}
                          </p>
                          {mapping && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Default: {mapping.defaultFormat} &bull; {getCourtName(mapping.defaultCourtId)} &bull; {mapping.defaultDurationMinutes}min
                              {mapping.timebandStart && ` &bull; ${mapping.timebandStart}–${mapping.timebandEnd}`}
                            </p>
                          )}
                        </div>
                        {canManageAgeGroups && (
                          <div className="flex gap-2">
                            <Button size="sm" variant="outline" onClick={() => openEdit(ag)}>
                              <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                            </Button>
                            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive"
                              onClick={() => setAgeGroupToDelete({ id: ag.id, label: ag.label })}>
                              Remove
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
            {!ageGroups?.length && <p className="text-muted-foreground text-center py-8">No age groups configured.</p>}
          </div>
        )}

        {canManageAgeGroups && (
          <Card>
            <CardHeader><CardTitle>Add Age Group</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {formError && <p className="text-red-600 text-sm">{formError}</p>}
              <div className="grid grid-cols-2 gap-4">
                <div><Label>Label</Label><Input placeholder="U10" value={newForm.label} onChange={e => setNewForm({...newForm, label: e.target.value})} /></div>
                <div><Label>Division</Label>
                  <select className="w-full border rounded px-3 py-2 text-sm" value={newForm.division} onChange={e => setNewForm({...newForm, division: e.target.value})}>
                    <option value="boy">Boys</option>
                    <option value="girl">Girls</option>
                    <option value="men">Men</option>
                    <option value="women">Women</option>
                    <option value="coed">Coed</option>
                    <option value="youth">Youth (legacy)</option>
                    <option value="adult">Adult (legacy)</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div><Label>Min Age</Label><Input type="number" placeholder="8" value={newForm.minAge} onChange={e => setNewForm({...newForm, minAge: e.target.value})} /></div>
                <div><Label>Max Age</Label><Input type="number" placeholder="10 (blank for open)" value={newForm.maxAge} onChange={e => setNewForm({...newForm, maxAge: e.target.value})} /></div>
                <div><Label>Display Order</Label><Input type="number" value={newForm.displayOrder} onChange={e => setNewForm({...newForm, displayOrder: e.target.value})} /></div>
              </div>
              <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
                {createMutation.isPending ? "Adding..." : "Add Age Group"}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      <AlertDialog open={ageGroupToDelete !== null} onOpenChange={(open) => { if (!open) setAgeGroupToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove "{ageGroupToDelete?.label}"?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete this age group. This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (ageGroupToDelete) { deleteMutation.mutate(ageGroupToDelete.id); setAgeGroupToDelete(null); } }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
