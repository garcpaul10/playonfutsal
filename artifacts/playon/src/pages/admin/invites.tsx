import React, { useState } from "react";
import { Redirect } from "wouter";
import { useGetMyProfile } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { format } from "date-fns";
import { Mail, Plus, Trash2, RefreshCw, UserPlus, Clock, CheckCircle2, XCircle, AlertCircle } from "lucide-react";

const ROLE_OPTIONS = [
  { value: "staff", label: "Staff Member" },
  { value: "ref", label: "Referee" },
  { value: "coach", label: "Coach" },
  { value: "scorekeeper", label: "Scorekeeper" },
];

type InviteStatus = "pending" | "accepted" | "expired" | "revoked";

interface StaffInvite {
  id: number;
  token: string;
  email: string;
  role: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  status: InviteStatus;
}

function StatusBadge({ status }: { status: InviteStatus }) {
  const map: Record<InviteStatus, { label: string; className: string; icon: React.ReactNode }> = {
    pending: { label: "Pending", className: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30", icon: <Clock className="h-3 w-3" /> },
    accepted: { label: "Accepted", className: "bg-green-500/15 text-green-400 border-green-500/30", icon: <CheckCircle2 className="h-3 w-3" /> },
    expired: { label: "Expired", className: "bg-gray-500/15 text-gray-400 border-gray-500/30", icon: <AlertCircle className="h-3 w-3" /> },
    revoked: { label: "Revoked", className: "bg-red-500/15 text-red-400 border-red-500/30", icon: <XCircle className="h-3 w-3" /> },
  };
  const { label, className, icon } = map[status];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${className}`}>
      {icon}{label}
    </span>
  );
}

export default function AdminInvites() {
  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const { getToken } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [showForm, setShowForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("staff");
  const [emailWarning, setEmailWarning] = useState<{ message: string; inviteUrl?: string } | null>(null);

  const { data: invites, isLoading } = useQuery<StaffInvite[]>({
    queryKey: ["staff-invites"],
    enabled: !profileLoading && (profile?.role === "admin" || profile?.role === "staff"),
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch("/api/admin/invites", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load invites");
      return res.json();
    },
  });

  const createInvite = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      const res = await fetch("/api/admin/invites", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to send invite");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["staff-invites"] });
      setShowForm(false);
      setInviteEmail("");
      setInviteRole("ref");
      if (data.emailWarning) {
        setEmailWarning({ message: data.emailWarning, inviteUrl: data.inviteUrl });
      } else {
        setEmailWarning(null);
        toast({ title: "Invite sent", description: `An invite link has been sent to ${inviteEmail}.` });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Failed to send invite", description: err.message, variant: "destructive" });
    },
  });

  const revokeInvite = useMutation({
    mutationFn: async (id: number) => {
      const token = await getToken();
      const res = await fetch(`/api/admin/invites/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to revoke invite");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-invites"] });
      toast({ title: "Invite revoked" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to revoke", description: err.message, variant: "destructive" });
    },
  });

  const resendInvite = useMutation({
    mutationFn: async (id: number) => {
      const token = await getToken();
      const res = await fetch(`/api/admin/invites/${id}/resend`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to resend invite");
      }
      return res.json();
    },
    onSuccess: (data) => {
      if (data.emailWarning) {
        setEmailWarning({ message: data.emailWarning, inviteUrl: data.inviteUrl });
      } else {
        setEmailWarning(null);
        toast({ title: "Invite resent", description: "A fresh invite link has been sent." });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Failed to resend", description: err.message, variant: "destructive" });
    },
  });

  if (profileLoading) return <Layout><div className="p-8"><Skeleton className="h-10 w-48" /></div></Layout>;
  if (!profile || (profile.role !== "admin" && profile.role !== "staff")) return <Redirect to="/dashboard" />;

  const roleLabel = (role: string) => ROLE_OPTIONS.find((r) => r.value === role)?.label ?? role;

  return (
    <Layout>
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        {emailWarning && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 flex gap-3">
            <AlertCircle className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-amber-300 font-semibold text-sm">Email delivery failed</p>
              <p className="text-amber-200/80 text-sm mt-0.5">{emailWarning.message}</p>
              {emailWarning.inviteUrl && (
                <div className="mt-2">
                  <p className="text-amber-200/60 text-xs mb-1">Invite link (share manually):</p>
                  <code className="block text-xs bg-black/30 rounded px-2 py-1.5 text-amber-100 break-all select-all">
                    {emailWarning.inviteUrl}
                  </code>
                </div>
              )}
            </div>
            <button
              onClick={() => setEmailWarning(null)}
              className="text-amber-400/60 hover:text-amber-400 text-lg leading-none flex-shrink-0"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        )}

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Staff Invites</h1>
            <p className="text-gray-400 text-sm mt-1">
              Invite referees, coaches, and scorekeepers by email. They'll receive a unique sign-up link.
            </p>
          </div>
          <Button
            onClick={() => setShowForm((v) => !v)}
            className="bg-primary hover:bg-primary/85 text-primary-foreground gap-2"
          >
            <Plus className="h-4 w-4" />
            Invite Staff
          </Button>
        </div>

        {showForm && (
          <Card className="bg-[#1e2a2a] border-[#2b353a]">
            <CardHeader>
              <CardTitle className="text-white text-base flex items-center gap-2">
                <UserPlus className="h-4 w-4 text-primary" />
                Send an Invite
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={(e) => { e.preventDefault(); createInvite.mutate(); }}
                className="space-y-4"
              >
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="invite-email" className="text-white text-sm">Email address</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <Input
                        id="invite-email"
                        type="email"
                        placeholder="referee@example.com"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        required
                        className="bg-[#2b353a] border-[#3b474c] text-white placeholder:text-gray-500 pl-9"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="invite-role" className="text-white text-sm">Role</Label>
                    <select
                      id="invite-role"
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value)}
                      className="w-full h-10 bg-[var(--brand-teal-700)] border border-[var(--brand-teal-600)] text-white rounded-md px-3 focus:outline-none focus:border-primary text-sm"
                    >
                      {ROLE_OPTIONS.map((r) => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Button
                    type="submit"
                    disabled={createInvite.isPending || !inviteEmail}
                    className="bg-primary hover:bg-primary/85 text-primary-foreground gap-2"
                  >
                    {createInvite.isPending ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <Mail className="h-4 w-4" />
                    )}
                    Send Invite
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setShowForm(false)}
                    className="text-gray-400 hover:text-white"
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        <Card className="bg-[#1e2a2a] border-[#2b353a]">
          <CardHeader>
            <CardTitle className="text-white text-base">Sent Invites</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : !invites || invites.length === 0 ? (
              <div className="text-center py-10">
                <UserPlus className="h-10 w-10 text-gray-600 mx-auto mb-3" />
                <p className="text-gray-400 text-sm">No invites sent yet.</p>
                <p className="text-gray-500 text-xs mt-1">Click "Invite Staff" to send your first invite.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#2b353a]">
                      <th className="text-left py-2 px-3 text-gray-400 font-medium text-xs uppercase tracking-wide">Email</th>
                      <th className="text-left py-2 px-3 text-gray-400 font-medium text-xs uppercase tracking-wide">Role</th>
                      <th className="text-left py-2 px-3 text-gray-400 font-medium text-xs uppercase tracking-wide">Sent</th>
                      <th className="text-left py-2 px-3 text-gray-400 font-medium text-xs uppercase tracking-wide">Expires</th>
                      <th className="text-left py-2 px-3 text-gray-400 font-medium text-xs uppercase tracking-wide">Status</th>
                      <th className="py-2 px-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {invites.map((inv) => (
                      <tr key={inv.id} className="border-b border-[#2b353a]/50 hover:bg-[#2b353a]/30 transition-colors">
                        <td className="py-3 px-3 text-white">{inv.email}</td>
                        <td className="py-3 px-3 text-gray-300">{roleLabel(inv.role)}</td>
                        <td className="py-3 px-3 text-gray-400 text-xs">
                          {format(new Date(inv.createdAt), "MMM d, yyyy")}
                        </td>
                        <td className="py-3 px-3 text-gray-400 text-xs">
                          {format(new Date(inv.expiresAt), "MMM d, yyyy")}
                        </td>
                        <td className="py-3 px-3">
                          <StatusBadge status={inv.status} />
                        </td>
                        <td className="py-3 px-3">
                          {inv.status === "pending" && (
                            <div className="flex items-center gap-2 justify-end">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => resendInvite.mutate(inv.id)}
                                disabled={resendInvite.isPending}
                                className="text-gray-400 hover:text-white h-7 px-2 gap-1"
                              >
                                <RefreshCw className="h-3 w-3" />
                                Resend
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => revokeInvite.mutate(inv.id)}
                                disabled={revokeInvite.isPending}
                                className="text-red-400 hover:text-red-300 h-7 px-2 gap-1"
                              >
                                <Trash2 className="h-3 w-3" />
                                Revoke
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
