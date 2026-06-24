import React, { useState } from "react";
import { Redirect, Link } from "wouter";
import { useGetMyProfile } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import {
  ChevronLeft, User, Users, ClipboardList, CreditCard,
  ShieldCheck, Mail, Trash2, KeyRound, ExternalLink,
  Unlink, AlertTriangle, RefreshCw, CheckCircle2, XCircle,
  DollarSign, Copy, Eye, Loader2,
} from "lucide-react";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

function fmt(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function safeFmt(d: string | null | undefined) {
  if (!d) return "—";
  try { return format(new Date(d), "MMM d, yyyy"); } catch { return d; }
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-800 border-green-200",
  confirmed: "bg-green-100 text-green-800 border-green-200",
  cancelled: "bg-red-100 text-red-800 border-red-200",
  waitlisted: "bg-amber-100 text-amber-800 border-amber-200",
  pending: "bg-gray-100 text-gray-700 border-gray-200",
  reserved: "bg-blue-100 text-blue-800 border-blue-200",
};

const TYPE_LABELS: Record<string, string> = {
  league: "League",
  tournament: "Tournament",
  camp: "Camp",
  dropin: "Drop-in",
};

interface AdminUserDetail {
  id: number;
  clerkId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  role: string;
  roles: string[];
  adminLevel?: string | null;
  idVerified: boolean | null;
  idVerifiedAt: string | null;
  idPhotoUrl: string | null;
  idVerificationStatus: "approved" | "pending" | "rejected" | "not_submitted";
  idVerifiedByName: string | null;
  idVerifiedByClerkId: string | null;
  idRejectionReason: string | null;
  createdAt: string;
  clerkEmail: string | null;
  lastSignInAt: number | null;
  // Player profile (read-only)
  skillLevel: string | null;
  primaryPosition: string | null;
  secondaryPosition: string | null;
  profileGender: string | null;
}

interface FamilyLink {
  id: number;
  direction: "guardian" | "child";
  relationship: string;
  status: string;
  isPrimary: boolean;
  canRegister: boolean;
  canPickup: boolean;
  createdAt: string;
  linkedUserId: number | null;
  linkedClerkId: string | null;
  linkedFirstName: string | null;
  linkedLastName: string | null;
  linkedEmail: string | null;
  linkedDateOfBirth: string | null;
}

interface RegEntry {
  id: number;
  type: string;
  eventName: string;
  startDate: string | null;
  endDate: string | null;
  status: string;
  paymentStatus: string;
  amountPaid: number;
  createdAt: string;
  eventId: number;
  eventPath: string;
}

interface PersonRegs {
  userId: number;
  firstName: string | null;
  lastName: string | null;
  email: string;
  clerkId: string;
  registrations: RegEntry[];
}

interface Payment {
  id: number;
  userId: number | null;
  entityType: string;
  entityId: number;
  amount: number;
  currency: string;
  status: string;
  provider: string;
  providerChargeId: string | null;
  receiptUrl: string | null;
  refunded: boolean;
  refundAmount: number | null;
  refundedAt: string | null;
  serviceFeeAmount: number;
  metadata: string | null;
  createdAt: string;
  personName: string;
  eventName: string | null;
}

interface Props {
  clerkId: string;
}

export default function AdminUserDetail({ clerkId }: Props) {
  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const { getToken } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [tab, setTab] = useState("account");

  const VALID_ROLES = ["player", "parent", "ref", "coach", "scorekeeper", "staff", "admin"] as const;

  // Account edit state
  const [editFirstName, setEditFirstName] = useState("");
  const [editLastName, setEditLastName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editDateOfBirth, setEditDateOfBirth] = useState("");
  const [editRoles, setEditRoles] = useState<string[]>([]);
  const [editAdminLevel, setEditAdminLevel] = useState<string>("super");
  const [editMode, setEditMode] = useState(false);

  // Dialogs
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [unlinkOpen, setUnlinkOpen] = useState<FamilyLink | null>(null);
  const [cancelRegOpen, setCancelRegOpen] = useState<{ type: string; id: number; name: string } | null>(null);
  const [refundOpen, setRefundOpen] = useState<Payment | null>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [resetTokenOpen, setResetTokenOpen] = useState<string | null>(null);
  const [idPhotoOpen, setIdPhotoOpen] = useState(false);
  const [idPhotoObjectUrl, setIdPhotoObjectUrl] = useState<string | null>(null);
  const [idPhotoLoading, setIdPhotoLoading] = useState(false);

  const userQuery = useQuery<AdminUserDetail>({
    queryKey: ["admin-user-detail", clerkId],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/clerk-users/${clerkId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load user");
      return res.json();
    },
    enabled: !!clerkId && !!profile && profile.role === "admin" && profile.adminLevel === "super",
  });

  const familyQuery = useQuery<FamilyLink[]>({
    queryKey: ["admin-user-family", clerkId],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/clerk-users/${clerkId}/family`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load family");
      return res.json();
    },
    enabled: tab === "family" && !!clerkId && !!profile && profile.role === "admin",
  });

  const regsQuery = useQuery<PersonRegs[]>({
    queryKey: ["admin-user-regs", clerkId],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/clerk-users/${clerkId}/registrations`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load registrations");
      return res.json();
    },
    enabled: tab === "registrations" && !!clerkId && !!profile && profile.role === "admin",
  });

  const paymentsQuery = useQuery<Payment[]>({
    queryKey: ["admin-user-payments", clerkId],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/clerk-users/${clerkId}/payments`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load payments");
      return res.json();
    },
    enabled: tab === "payments" && !!clerkId && !!profile && profile.role === "admin",
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { firstName?: string; lastName?: string; email?: string; phone?: string; dateOfBirth?: string }) => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/clerk-users/${clerkId}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? "Update failed"); }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Profile updated" });
      qc.invalidateQueries({ queryKey: ["admin-user-detail", clerkId] });
      setEditMode(false);
    },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const rolesMutation = useMutation({
    mutationFn: async ({ userId, roles, adminLevel }: { userId: number; roles: string[]; adminLevel?: string }) => {
      const token = await getToken();
      const body: Record<string, any> = { roles };
      if (roles.includes("admin") && adminLevel) body.adminLevel = adminLevel;
      const res = await fetch(`${API_BASE}/admin/users/${userId}/roles`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? "Role update failed"); }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Roles updated" });
      qc.invalidateQueries({ queryKey: ["admin-user-detail", clerkId] });
    },
    onError: (e: Error) => toast({ title: "Role update failed", description: e.message, variant: "destructive" }),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/clerk-users/${clerkId}/reset-password`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? "Failed"); }
      return res.json() as Promise<{ token: string; url: string | null }>;
    },
    onSuccess: (data) => {
      setResetTokenOpen(data.url ?? `Sign-in token: ${data.token}`);
    },
    onError: (e: Error) => toast({ title: "Failed to generate reset link", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/users/${clerkId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? "Delete failed"); }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Account deleted" });
      window.location.href = `${import.meta.env.BASE_URL}admin/users`;
    },
    onError: (e: Error) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const unlinkMutation = useMutation({
    mutationFn: async (linkId: number) => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/clerk-users/${clerkId}/family/${linkId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? "Unlink failed"); }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Family link removed" });
      qc.invalidateQueries({ queryKey: ["admin-user-family", clerkId] });
      setUnlinkOpen(null);
    },
    onError: (e: Error) => toast({ title: "Unlink failed", description: e.message, variant: "destructive" }),
  });

  const cancelRegMutation = useMutation({
    mutationFn: async ({ type, id }: { type: string; id: number }) => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/registrations/${type}/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? "Cancel failed"); }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Registration cancelled" });
      qc.invalidateQueries({ queryKey: ["admin-user-regs", clerkId] });
      setCancelRegOpen(null);
    },
    onError: (e: Error) => toast({ title: "Cancel failed", description: e.message, variant: "destructive" }),
  });

  const refundMutation = useMutation({
    mutationFn: async ({ paymentId, amount, reason }: { paymentId: number; amount: number; reason: string }) => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/payments/${paymentId}/refund`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ amount, reason }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? "Refund failed"); }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Refund processed" });
      qc.invalidateQueries({ queryKey: ["admin-user-payments", clerkId] });
      setRefundOpen(null);
      setRefundAmount("");
      setRefundReason("");
    },
    onError: (e: Error) => toast({ title: "Refund failed", description: e.message, variant: "destructive" }),
  });

  if (profileLoading) {
    return (
      <Layout>
        <div className="p-8 space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-96" />
        </div>
      </Layout>
    );
  }

  if (profile?.role !== "admin" || profile.adminLevel !== "super") {
    return <Redirect to="/admin" />;
  }

  const user = userQuery.data;

  function displayName(u: AdminUserDetail | undefined) {
    if (!u) return "Loading…";
    const n = [u.firstName, u.lastName].filter(Boolean).join(" ");
    return n || u.email;
  }

  function startEdit() {
    if (!user) return;
    setEditFirstName(user.firstName ?? "");
    setEditLastName(user.lastName ?? "");
    setEditEmail(user.email ?? "");
    setEditPhone(user.phone ?? "");
    setEditDateOfBirth(user.dateOfBirth ?? "");
    setEditRoles(user.roles?.length ? user.roles : user.role ? [user.role] : []);
    setEditAdminLevel(user.adminLevel ?? "super");
    setEditMode(true);
  }

  async function submitEdit() {
    if (!user) return;
    const profileChanged =
      editFirstName.trim() !== (user.firstName ?? "") ||
      editLastName.trim() !== (user.lastName ?? "") ||
      editEmail.trim() !== (user.email ?? "") ||
      editPhone.trim() !== (user.phone ?? "") ||
      editDateOfBirth !== (user.dateOfBirth ?? "");

    const originalRoles = user.roles?.length ? user.roles : user.role ? [user.role] : [];
    const rolesChanged =
      JSON.stringify([...editRoles].sort()) !== JSON.stringify([...originalRoles].sort()) ||
      (editRoles.includes("admin") && editAdminLevel !== (user.adminLevel ?? "super"));

    const saves: Promise<any>[] = [];

    if (profileChanged) {
      saves.push(updateMutation.mutateAsync({
        firstName: editFirstName.trim() || undefined,
        lastName: editLastName.trim() || undefined,
        email: editEmail.trim() || undefined,
        // Send explicit empty string when clearing so the backend can null-out the field
        phone: editPhone.trim(),
        dateOfBirth: editDateOfBirth,
      }));
    }

    if (rolesChanged) {
      saves.push(rolesMutation.mutateAsync({
        userId: user.id,
        roles: editRoles,
        adminLevel: editRoles.includes("admin") ? editAdminLevel : undefined,
      }));
    }

    if (saves.length === 0) {
      setEditMode(false);
      return;
    }

    try {
      await Promise.all(saves);
      if (!profileChanged) {
        // roles-only save; profile mutation won't close edit mode
        qc.invalidateQueries({ queryKey: ["admin-user-detail", clerkId] });
        setEditMode(false);
      }
    } catch {
      // errors handled per-mutation
    }
  }

  function toggleRole(r: string) {
    setEditRoles((prev) =>
      prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]
    );
  }

  return (
    <Layout>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Link href="/admin/users">
            <button type="button" className="text-muted-foreground hover:text-foreground transition-colors">
              <ChevronLeft className="h-5 w-5" />
            </button>
          </Link>
          <div className="flex-1 min-w-0">
            {userQuery.isLoading ? (
              <Skeleton className="h-7 w-48" />
            ) : (
              <>
                <h1 className="text-xl font-bold text-foreground">{displayName(user)}</h1>
                <p className="text-sm text-muted-foreground">{user?.email}</p>
              </>
            )}
          </div>
          {user && (
            <div className="flex items-center gap-2">
              {user.idVerified && (
                <Badge variant="outline" className="bg-green-100 text-green-800 border-green-200 gap-1">
                  <ShieldCheck className="h-3 w-3" />
                  ID Verified
                </Badge>
              )}
              <Badge variant="outline" className="capitalize">
                {user.role}{user.adminLevel ? ` (${user.adminLevel})` : ""}
              </Badge>
            </div>
          )}
        </div>

        {/* Tabs */}
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="account" className="flex items-center gap-1.5">
              <User className="h-3.5 w-3.5" />Account
            </TabsTrigger>
            <TabsTrigger value="family" className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" />Family
            </TabsTrigger>
            <TabsTrigger value="registrations" className="flex items-center gap-1.5">
              <ClipboardList className="h-3.5 w-3.5" />Registrations
            </TabsTrigger>
            <TabsTrigger value="payments" className="flex items-center gap-1.5">
              <CreditCard className="h-3.5 w-3.5" />Payments
            </TabsTrigger>
          </TabsList>

          {/* ── Account Tab ── */}
          <TabsContent value="account" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Profile</CardTitle>
                  {!editMode && (
                    <Button variant="outline" size="sm" onClick={startEdit}>Edit</Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {userQuery.isLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-10" />
                    <Skeleton className="h-10" />
                    <Skeleton className="h-10" />
                  </div>
                ) : editMode ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label>First name</Label>
                        <Input value={editFirstName} onChange={(e) => setEditFirstName(e.target.value)} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Last name</Label>
                        <Input value={editLastName} onChange={(e) => setEditLastName(e.target.value)} />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Email</Label>
                      <Input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label>Phone</Label>
                        <Input type="tel" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="+1 555 000 0000" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Date of birth</Label>
                        <Input type="date" value={editDateOfBirth} onChange={(e) => setEditDateOfBirth(e.target.value)} />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Roles</Label>
                      <div className="flex flex-wrap gap-2">
                        {VALID_ROLES.map((r) => (
                          <button
                            key={r}
                            type="button"
                            onClick={() => toggleRole(r)}
                            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                              editRoles.includes(r)
                                ? "bg-primary text-primary-foreground border-primary"
                                : "bg-background text-muted-foreground border-border hover:border-primary/50"
                            }`}
                          >
                            {r}
                          </button>
                        ))}
                      </div>
                    </div>
                    {editRoles.includes("admin") && (
                      <div className="space-y-1.5">
                        <Label>Admin level</Label>
                        <div className="flex gap-3">
                          {(["super", "scoped"] as const).map((level) => (
                            <button
                              key={level}
                              type="button"
                              onClick={() => setEditAdminLevel(level)}
                              className={`px-4 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                                editAdminLevel === level
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "bg-background text-muted-foreground border-border hover:border-primary/50"
                              }`}
                            >
                              {level === "super" ? "Super admin" : "Scoped admin"}
                            </button>
                          ))}
                        </div>
                        <p className="text-xs text-muted-foreground">Super admins have full access. Scoped admins only see what you enable for them.</p>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Button onClick={submitEdit} disabled={updateMutation.isPending || rolesMutation.isPending}>
                        {(updateMutation.isPending || rolesMutation.isPending) ? "Saving…" : "Save changes"}
                      </Button>
                      <Button variant="ghost" onClick={() => setEditMode(false)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
                    <div>
                      <dt className="text-muted-foreground font-medium">First name</dt>
                      <dd className="text-foreground mt-0.5">{user?.firstName ?? <span className="text-muted-foreground italic">not set</span>}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground font-medium">Last name</dt>
                      <dd className="text-foreground mt-0.5">{user?.lastName ?? <span className="text-muted-foreground italic">not set</span>}</dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-muted-foreground font-medium">Email</dt>
                      <dd className="text-foreground mt-0.5">{user?.email}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground font-medium">Phone</dt>
                      <dd className="text-foreground mt-0.5">{user?.phone ?? <span className="text-muted-foreground italic">not set</span>}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground font-medium">Date of birth</dt>
                      <dd className="text-foreground mt-0.5">{user?.dateOfBirth ? safeFmt(user.dateOfBirth) : <span className="text-muted-foreground italic">not set</span>}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground font-medium">Role(s)</dt>
                      <dd className="text-foreground mt-0.5 capitalize">
                        {user?.roles?.length
                          ? user.roles.join(", ")
                          : (user?.role ?? "—")}
                        {user?.adminLevel ? ` (${user.adminLevel})` : ""}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground font-medium">Member since</dt>
                      <dd className="text-foreground mt-0.5">{user?.createdAt ? safeFmt(user.createdAt) : "—"}</dd>
                    </div>
                    {user?.lastSignInAt && (
                      <div className="col-span-2">
                        <dt className="text-muted-foreground font-medium">Last sign in</dt>
                        <dd className="text-foreground mt-0.5">{safeFmt(new Date(user.lastSignInAt).toISOString())}</dd>
                      </div>
                    )}
                  </dl>
                )}
              </CardContent>
            </Card>

            {/* ID Verification — always shown */}
            {user && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">ID Verification</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-3 flex-wrap">
                    {user.idVerificationStatus === "approved" ? (
                      <Badge variant="outline" className="bg-green-100 text-green-800 border-green-200 gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        Approved
                      </Badge>
                    ) : user.idVerificationStatus === "rejected" ? (
                      <Badge variant="outline" className="bg-red-100 text-red-800 border-red-200 gap-1">
                        <XCircle className="h-3 w-3" />
                        Rejected
                      </Badge>
                    ) : user.idVerificationStatus === "pending" ? (
                      <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-200 gap-1">
                        <RefreshCw className="h-3 w-3" />
                        Pending review
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-gray-100 text-gray-600 border-gray-200 gap-1">
                        <XCircle className="h-3 w-3" />
                        Not submitted
                      </Badge>
                    )}
                    {user.idVerifiedAt && user.idVerificationStatus === "approved" && (
                      <span className="text-xs text-muted-foreground">
                        Approved {safeFmt(user.idVerifiedAt)}
                        {user.idVerifiedByName && (
                          <> by <span className="font-medium">{user.idVerifiedByName}</span></>
                        )}
                      </span>
                    )}
                  </div>
                  {user.idVerificationStatus === "rejected" && user.idRejectionReason && (
                    <div className="mt-1 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
                      <span className="font-medium">Rejection reason:</span> {user.idRejectionReason}
                    </div>
                  )}
                  {user.idPhotoUrl && (
                    <div className="flex items-start justify-between gap-4 pt-1">
                      <div>
                        <p className="text-sm font-medium text-foreground">Government-issued ID photo</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          View the ID photo submitted during onboarding. Link expires after 15 minutes.
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-shrink-0"
                        disabled={idPhotoLoading}
                        onClick={async () => {
                          setIdPhotoLoading(true);
                          try {
                            const token = await getToken();
                            const res = await fetch(`${API_BASE}/admin/users/${clerkId}/id-photo`, {
                              headers: { Authorization: `Bearer ${token}` },
                            });
                            if (!res.ok) {
                              const e = await res.json();
                              throw new Error(e.error ?? "Failed to load photo");
                            }
                            const blob = await res.blob();
                            const objectUrl = URL.createObjectURL(blob);
                            setIdPhotoObjectUrl(objectUrl);
                            setIdPhotoOpen(true);
                          } catch (e: any) {
                            toast({ title: "Failed to load ID photo", description: e.message, variant: "destructive" });
                          } finally {
                            setIdPhotoLoading(false);
                          }
                        }}
                      >
                        {idPhotoLoading ? (
                          <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                        ) : (
                          <Eye className="h-3.5 w-3.5 mr-1.5" />
                        )}
                        View ID
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Sport & skill profile — always shown, read-only */}
            {user && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Sport profile</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                    <div className="col-span-2">
                      <dt className="text-muted-foreground font-medium">Sport preferences</dt>
                      <dd className="text-foreground mt-0.5 capitalize">
                        {[user.primaryPosition, user.secondaryPosition].filter(Boolean).join(" · ") || (
                          <span className="text-muted-foreground italic">not set</span>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground font-medium">Skill level</dt>
                      <dd className="text-foreground mt-0.5 capitalize">
                        {user.skillLevel ?? <span className="text-muted-foreground italic">not set</span>}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground font-medium">Gender</dt>
                      <dd className="text-foreground mt-0.5 capitalize">
                        {user.profileGender ?? <span className="text-muted-foreground italic">not set</span>}
                      </dd>
                    </div>
                  </dl>
                  <p className="text-xs text-muted-foreground mt-3">These fields are managed by the player and are read-only here.</p>
                </CardContent>
              </Card>
            )}

            {/* Actions */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-start justify-between gap-4 pb-3 border-b border-border">
                  <div>
                    <p className="text-sm font-medium text-foreground">Password reset link</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Generate a one-time sign-in link you can share with the user to regain access.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-shrink-0"
                    onClick={() => resetPasswordMutation.mutate()}
                    disabled={resetPasswordMutation.isPending}
                  >
                    <KeyRound className="h-3.5 w-3.5 mr-1.5" />
                    {resetPasswordMutation.isPending ? "Generating…" : "Generate link"}
                  </Button>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-red-600 dark:text-red-400">Delete account</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Permanently removes this user from Clerk and the database. This cannot be undone.
                    </p>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="flex-shrink-0"
                    onClick={() => { setDeleteConfirmText(""); setDeleteOpen(true); }}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Family Tab ── */}
          <TabsContent value="family" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Family links</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {familyQuery.isLoading ? (
                  <div className="p-6 space-y-3">
                    <Skeleton className="h-14" />
                    <Skeleton className="h-14" />
                  </div>
                ) : !familyQuery.data?.length ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">
                    No family links for this user.
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {familyQuery.data.map((link) => (
                      <div key={link.id} className="flex items-center gap-4 px-5 py-4">
                        <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center flex-shrink-0 text-sm font-semibold text-muted-foreground">
                          {(link.linkedFirstName?.[0] ?? link.linkedEmail?.[0] ?? "?").toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-foreground">
                              {[link.linkedFirstName, link.linkedLastName].filter(Boolean).join(" ") || link.linkedEmail || "Unknown"}
                            </span>
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 capitalize">
                              {link.direction === "guardian" ? `Their child · ${link.relationship}` : `Their guardian · ${link.relationship}`}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-3 mt-0.5">
                            <span className="text-xs text-muted-foreground">{link.linkedEmail}</span>
                            {link.linkedDateOfBirth && (
                              <span className="text-xs text-muted-foreground">DOB: {safeFmt(link.linkedDateOfBirth)}</span>
                            )}
                            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${link.status === "approved" ? "text-green-600 border-green-200 bg-green-50" : "text-amber-600 border-amber-200 bg-amber-50"}`}>
                              {link.status}
                            </Badge>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {link.linkedClerkId && (
                            <Link href={`/admin/users/${link.linkedClerkId}`}>
                              <Button variant="ghost" size="sm" title="View this user">
                                <ExternalLink className="h-3.5 w-3.5" />
                              </Button>
                            </Link>
                          )}
                          <Button variant="ghost" size="sm" title="Remove link" onClick={() => setUnlinkOpen(link)}>
                            <Unlink className="h-3.5 w-3.5 text-red-500" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Registrations Tab ── */}
          <TabsContent value="registrations" className="mt-4 space-y-4">
            {regsQuery.isLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-40" />
                <Skeleton className="h-40" />
              </div>
            ) : !regsQuery.data?.length ? (
              <Card>
                <CardContent className="p-8 text-center text-sm text-muted-foreground">
                  No registrations found.
                </CardContent>
              </Card>
            ) : (
              regsQuery.data.map((person) => (
                <Card key={person.userId}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      {[person.firstName, person.lastName].filter(Boolean).join(" ") || person.email}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    {person.registrations.length === 0 ? (
                      <p className="px-5 pb-4 text-xs text-muted-foreground">No registrations.</p>
                    ) : (
                      <div className="divide-y divide-border">
                        {person.registrations.map((reg) => (
                          <div key={`${reg.type}-${reg.id}`} className="flex items-center gap-4 px-5 py-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium text-foreground">{reg.eventName}</span>
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                  {TYPE_LABELS[reg.type] ?? reg.type}
                                </Badge>
                                <Badge variant="outline" className={`text-[10px] px-1.5 py-0 capitalize ${STATUS_COLORS[reg.status] ?? ""}`}>
                                  {reg.status}
                                </Badge>
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {reg.startDate ? safeFmt(reg.startDate) : ""}
                                {reg.endDate && reg.endDate !== reg.startDate ? ` → ${safeFmt(reg.endDate)}` : ""}
                                {reg.amountPaid > 0 && ` · Paid ${fmt(reg.amountPaid)}`}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <Link href={reg.eventPath}>
                                <Button variant="ghost" size="sm" title="View event">
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </Button>
                              </Link>
                              {reg.status !== "cancelled" && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  title="Cancel registration"
                                  onClick={() => setCancelRegOpen({ type: reg.type, id: reg.id, name: reg.eventName })}
                                >
                                  <XCircle className="h-3.5 w-3.5 text-red-500" />
                                </Button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>

          {/* ── Payments Tab ── */}
          <TabsContent value="payments" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Payment history</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {paymentsQuery.isLoading ? (
                  <div className="p-6 space-y-3">
                    <Skeleton className="h-16" />
                    <Skeleton className="h-16" />
                    <Skeleton className="h-16" />
                  </div>
                ) : !paymentsQuery.data?.length ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">No payments found.</div>
                ) : (
                  <div className="divide-y divide-border">
                    {paymentsQuery.data.map((p) => {
                      const isRefunded = p.refunded;
                      const isPartial = !p.refunded && p.refundAmount != null && p.refundAmount > 0;
                      return (
                        <div key={p.id} className="flex items-center gap-4 px-5 py-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-semibold text-foreground">{fmt(p.amount)}</span>
                              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${isRefunded ? "bg-red-100 text-red-800 border-red-200" : isPartial ? "bg-amber-100 text-amber-800 border-amber-200" : p.status === "paid" ? "bg-green-100 text-green-800 border-green-200" : "bg-gray-100 text-gray-700 border-gray-200"}`}>
                                {isRefunded ? "Refunded" : isPartial ? "Partial refund" : p.status}
                              </Badge>
                              <span className="text-xs text-muted-foreground capitalize">{p.entityType.replace("_", "-")}</span>
                            </div>
                            {p.eventName && (
                              <p className="text-sm text-foreground/80 mt-0.5">{p.eventName}</p>
                            )}
                            <div className="flex items-center gap-3 mt-0.5">
                              <span className="text-xs text-muted-foreground">{p.personName}</span>
                              <span className="text-xs text-muted-foreground">{safeFmt(p.createdAt)}</span>
                              {p.providerChargeId && (
                                <span className="text-xs text-muted-foreground font-mono truncate max-w-[120px]" title={p.providerChargeId}>
                                  {p.providerChargeId}
                                </span>
                              )}
                            </div>
                            {(isRefunded || isPartial) && p.refundAmount != null && (
                              <p className="text-xs text-red-600 mt-0.5">
                                Refunded {fmt(p.refundAmount)}{p.refundedAt ? ` on ${safeFmt(p.refundedAt)}` : ""}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {p.receiptUrl && (
                              <a href={p.receiptUrl} target="_blank" rel="noopener noreferrer">
                                <Button variant="ghost" size="sm" title="View receipt">
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </Button>
                              </a>
                            )}
                            {!isRefunded && p.provider !== "external" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                title="Refund"
                                onClick={() => {
                                  setRefundOpen(p);
                                  setRefundAmount(String(p.amount));
                                  setRefundReason("");
                                }}
                              >
                                <RefreshCw className="h-3.5 w-3.5 text-amber-500" />
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* ── ID Photo Dialog ── */}
      <Dialog open={idPhotoOpen} onOpenChange={(o) => { if (!o) { setIdPhotoOpen(false); if (idPhotoObjectUrl) { URL.revokeObjectURL(idPhotoObjectUrl); } setIdPhotoObjectUrl(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-green-600" />
              Government-issued ID
            </DialogTitle>
            <DialogDescription>
              Viewing <strong>{displayName(user)}</strong>'s ID photo.
            </DialogDescription>
          </DialogHeader>
          {idPhotoObjectUrl && (
            <div className="rounded-lg overflow-hidden bg-muted flex items-center justify-center min-h-[200px]">
              <img
                src={idPhotoObjectUrl}
                alt="User government-issued ID"
                className="max-w-full max-h-[60vh] object-contain"
                onError={() => toast({ title: "Failed to load image", description: "Close and try again.", variant: "destructive" })}
              />
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => { setIdPhotoOpen(false); if (idPhotoObjectUrl) { URL.revokeObjectURL(idPhotoObjectUrl); } setIdPhotoObjectUrl(null); }}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Account Dialog ── */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              Delete account
            </DialogTitle>
            <DialogDescription>
              This will permanently delete <strong>{displayName(user)}</strong> from Clerk and the database.
              This action cannot be undone. All their registrations and data will be lost.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Type <strong>DELETE</strong> to confirm</Label>
            <Input
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="DELETE"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={deleteConfirmText !== "DELETE" || deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reset Password Link Dialog ── */}
      <Dialog open={!!resetTokenOpen} onOpenChange={() => setResetTokenOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-blue-500" />
              Sign-in link generated
            </DialogTitle>
            <DialogDescription>
              Share this link with the user. It expires in 24 hours. They can sign in with this link and then update their password from account settings.
            </DialogDescription>
          </DialogHeader>
          <div className="bg-muted rounded-lg p-3 text-xs font-mono break-all select-all">
            {resetTokenOpen}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { if (resetTokenOpen) navigator.clipboard.writeText(resetTokenOpen); toast({ title: "Copied to clipboard" }); }}
            >
              <Copy className="h-4 w-4 mr-2" />
              Copy link
            </Button>
            <Button onClick={() => setResetTokenOpen(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Unlink Family Dialog ── */}
      <Dialog open={!!unlinkOpen} onOpenChange={() => setUnlinkOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove family link</DialogTitle>
            <DialogDescription>
              This will remove the family link between{" "}
              <strong>{displayName(user)}</strong> and{" "}
              <strong>
                {[unlinkOpen?.linkedFirstName, unlinkOpen?.linkedLastName].filter(Boolean).join(" ") || unlinkOpen?.linkedEmail || "this user"}
              </strong>.
              Their accounts will remain active.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setUnlinkOpen(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={unlinkMutation.isPending}
              onClick={() => unlinkOpen && unlinkMutation.mutate(unlinkOpen.id)}
            >
              {unlinkMutation.isPending ? "Removing…" : "Remove link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Cancel Registration Dialog ── */}
      <Dialog open={!!cancelRegOpen} onOpenChange={() => setCancelRegOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel registration</DialogTitle>
            <DialogDescription>
              Cancel <strong>{cancelRegOpen?.name}</strong>? This will free the spot and mark the registration as cancelled.
              It will not automatically issue a refund.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCancelRegOpen(null)}>Keep registration</Button>
            <Button
              variant="destructive"
              disabled={cancelRegMutation.isPending}
              onClick={() => cancelRegOpen && cancelRegMutation.mutate({ type: cancelRegOpen.type, id: cancelRegOpen.id })}
            >
              {cancelRegMutation.isPending ? "Cancelling…" : "Cancel registration"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Refund Dialog ── */}
      <Dialog open={!!refundOpen} onOpenChange={(o) => { if (!o) { setRefundOpen(null); setRefundAmount(""); setRefundReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-amber-500" />
              Refund payment
            </DialogTitle>
            <DialogDescription>
              Original charge: <strong>{refundOpen ? fmt(refundOpen.amount) : ""}</strong>
              {refundOpen?.providerChargeId && (
                <span className="ml-2 font-mono text-xs">{refundOpen.providerChargeId}</span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Refund amount (USD)</Label>
              <Input
                type="number"
                min="0.01"
                max={refundOpen?.amount ?? 9999}
                step="0.01"
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value)}
                placeholder="0.00"
              />
              {refundOpen && (
                <p className="text-xs text-muted-foreground">
                  Max refundable: {fmt(refundOpen.amount)}
                  {" · "}
                  <button type="button" className="text-primary underline" onClick={() => setRefundAmount(String(refundOpen.amount))}>
                    Full refund
                  </button>
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Reason <span className="text-red-500">*</span></Label>
              <Input
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                placeholder="e.g. Player injury, event cancelled…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setRefundOpen(null); setRefundAmount(""); setRefundReason(""); }}>Cancel</Button>
            <Button
              disabled={
                refundMutation.isPending ||
                !refundAmount ||
                parseFloat(refundAmount) <= 0 ||
                !refundReason.trim() ||
                !refundOpen
              }
              onClick={() => {
                if (!refundOpen) return;
                refundMutation.mutate({
                  paymentId: refundOpen.id,
                  amount: parseFloat(refundAmount),
                  reason: refundReason,
                });
              }}
            >
              {refundMutation.isPending ? "Processing…" : `Refund ${refundAmount ? fmt(parseFloat(refundAmount) || 0) : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
