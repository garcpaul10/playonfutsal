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
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
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

interface Court {
  id: number;
  name: string;
  type: string;
  description: string | null;
  maxPlayers: number | null;
  availableForScheduling: boolean;
}

export default function AdminCourts() {
  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const { canManageCourts } = useAdminPermissions();
  const { getToken } = useAuth();
  const qc = useQueryClient();

  const [editing, setEditing] = useState<Court | null>(null);
  const [courtToDelete, setCourtToDelete] = useState<number | null>(null);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("full");
  const [newDesc, setNewDesc] = useState("");
  const [newMax, setNewMax] = useState("10");
  const [formError, setFormError] = useState("");

  const { data: courts, isLoading } = useQuery<Court[]>({
    queryKey: ["courts"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/courts`);
      if (!res.ok) throw new Error("Failed to load courts");
      return res.json();
    },
  });

  const authHeader = async () => {
    const token = await getToken();
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!newName.trim()) throw new Error("Name is required");
      const headers = await authHeader();
      const res = await fetch(`${API_BASE}/courts`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name: newName.trim(), type: newType, description: newDesc || null, maxPlayers: parseInt(newMax) || 10, availableForScheduling: true }),
      });
      if (!res.ok) throw new Error("Failed to create court");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["courts"] });
      setNewName(""); setNewType("full"); setNewDesc(""); setNewMax("10"); setFormError("");
    },
    onError: (e: Error) => setFormError(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: async (court: Court) => {
      const headers = await authHeader();
      const res = await fetch(`${API_BASE}/courts/${court.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ name: court.name, type: court.type, description: court.description, maxPlayers: court.maxPlayers, availableForScheduling: court.availableForScheduling }),
      });
      if (!res.ok) throw new Error("Failed to update court");
      return res.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["courts"] }); setEditing(null); },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const headers = await authHeader();
      const res = await fetch(`${API_BASE}/courts/${id}`, { method: "DELETE", headers });
      if (!res.ok) throw new Error("Failed to delete court");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["courts"] }),
  });

  if (profileLoading) return <Layout><div className="p-12"><Skeleton className="h-64" /></div></Layout>;
  if (!profile || (profile.role !== "admin" && profile.role !== "staff" && profile.adminLevel !== "super" && profile.adminLevel !== "admin")) return <Redirect to="/dashboard" />;

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold font-sans uppercase tracking-tight text-primary">Court Management</h1>
            <p className="text-muted-foreground mt-1">Configure courts at the Alumni Center</p>
          </div>
          <Button variant="outline" onClick={() => history.back()}>Back to Admin</Button>
        </div>

        {isLoading ? (
          <div className="space-y-4">{[1,2].map(i => <Skeleton key={i} className="h-24" />)}</div>
        ) : (
          <div className="space-y-4 mb-10">
            {courts?.map((court) => (
              <Card key={court.id}>
                <CardContent className="pt-5">
                  {editing?.id === court.id ? (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div><Label>Name</Label><Input value={editing.name} onChange={e => setEditing({...editing, name: e.target.value})} /></div>
                        <div><Label>Type</Label>
                          <select className="w-full border rounded px-3 py-2 text-sm" value={editing.type} onChange={e => setEditing({...editing, type: e.target.value})}>
                            <option value="full">Full (5v5 + GK)</option>
                            <option value="small_sided">Small-sided (4v4/3v3)</option>
                          </select>
                        </div>
                      </div>
                      <div><Label>Description</Label><Input value={editing.description ?? ""} onChange={e => setEditing({...editing, description: e.target.value})} /></div>
                      <div><Label>Max Players</Label><Input type="number" value={editing.maxPlayers ?? 10} onChange={e => setEditing({...editing, maxPlayers: parseInt(e.target.value)})} /></div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => updateMutation.mutate(editing)} disabled={updateMutation.isPending}>Save</Button>
                        <Button size="sm" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-semibold text-lg">{court.name}</p>
                        <p className="text-sm text-muted-foreground">{court.type === "full" ? "Full-size (5v5 with goalies)" : "Small-sided (4v4/3v3)"} &bull; Max {court.maxPlayers} players</p>
                        {court.description && <p className="text-sm mt-1">{court.description}</p>}
                      </div>
                      {canManageCourts && (
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => setEditing({...court})}>Edit</Button>
                          <Button size="sm" variant="destructive" onClick={() => setCourtToDelete(court.id)}>Delete</Button>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
            {!courts?.length && <p className="text-muted-foreground text-center py-8">No courts configured yet.</p>}
          </div>
        )}

        {canManageCourts && (
          <Card>
            <CardHeader><CardTitle>Add Court</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {formError && <p className="text-red-600 text-sm">{formError}</p>}
              <div className="grid grid-cols-2 gap-4">
                <div><Label>Name</Label><Input placeholder="Court 3" value={newName} onChange={e => setNewName(e.target.value)} /></div>
                <div><Label>Type</Label>
                  <select className="w-full border rounded px-3 py-2 text-sm" value={newType} onChange={e => setNewType(e.target.value)}>
                    <option value="full">Full (5v5 + GK)</option>
                    <option value="small_sided">Small-sided (4v4/3v3)</option>
                  </select>
                </div>
              </div>
              <div><Label>Description</Label><Input placeholder="Optional description" value={newDesc} onChange={e => setNewDesc(e.target.value)} /></div>
              <div><Label>Max Players</Label><Input type="number" value={newMax} onChange={e => setNewMax(e.target.value)} /></div>
              <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
                {createMutation.isPending ? "Adding..." : "Add Court"}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      <AlertDialog open={courtToDelete !== null} onOpenChange={(open) => { if (!open) setCourtToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete court?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently remove the court. This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (courtToDelete !== null) { deleteMutation.mutate(courtToDelete); setCourtToDelete(null); } }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
