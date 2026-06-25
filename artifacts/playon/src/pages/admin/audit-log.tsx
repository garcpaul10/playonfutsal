import { API_BASE } from "@/lib/api-base";
import React, { useState, useRef, useEffect } from "react";
import { Redirect } from "wouter";
import { useGetMyProfile } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { format } from "date-fns";

interface AuditLogEntry {
  id: number;
  actorClerkId: string | null;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string | null;
  before: string | null;
  after: string | null;
  ipAddress: string | null;
  notes: string | null;
  summary: string;
  createdAt: string;
}

interface UserSearchResult {
  id: number;
  clerkId: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
}

const ACTION_COLORS: Record<string, string> = {
  create: "bg-green-700",
  update: "bg-blue-700",
  delete: "bg-red-700",
  deactivate: "bg-amber-700",
  approve: "bg-green-700",
  reject: "bg-red-700",
  refund: "bg-purple-700",
  execute: "bg-indigo-700",
  retry: "bg-orange-700",
};

function actionColor(action: string): string {
  for (const [key, cls] of Object.entries(ACTION_COLORS)) {
    if (action === key || action.endsWith(key)) return cls;
  }
  return "bg-gray-600";
}

const ALL_ENTITY_TYPES = [
  ["pricing_rule", "Pricing Rule"],
  ["facility_split_rule", "Facility Split Rule"],
  ["service_fee_config", "Service Fee Config"],
  ["refund_credit_policy", "Refund/Credit Policy"],
  ["user", "User"],
  ["user_membership", "User Membership"],
  ["membership_plan", "Membership Plan"],
  ["guardian", "Guardian"],
  ["staff_profile", "Staff Profile"],
  ["court", "Court"],
  ["venue", "Venue"],
  ["fixture", "Fixture"],
  ["league", "League"],
  ["tournament", "Tournament"],
  ["registration", "Registration"],
  ["dropin", "Drop-in"],
  ["dropin_spot", "Drop-in Spot"],
  ["camp_registration", "Camp Registration"],
  ["camp_day", "Camp Day"],
  ["incident_report", "Incident Report"],
  ["payment", "Payment"],
  ["payout", "Payout"],
  ["account_credit", "Account Credit"],
  ["discount_code", "Discount Code"],
  ["revenue_record", "Revenue Record"],
  ["stripe_connect_account", "Stripe Connect Account"],
];

const ALL_ACTIONS = [
  ["create", "create"],
  ["update", "update"],
  ["delete", "delete"],
  ["deactivate", "deactivate"],
  ["approve", "approve"],
  ["reject", "reject"],
  ["execute", "execute (payout)"],
  ["retry", "retry (payout)"],
  ["refund", "refund"],
  ["mark_paid_external", "mark_paid_external"],
  ["payment_status_updated", "payment_status_updated"],
  ["user.role_changed", "user.role_changed"],
  ["user.admin_level_changed", "user.admin_level_changed"],
  ["user.id_manually_approved", "user.id_manually_approved"],
  ["user.profile_updated", "user.profile_updated"],
  ["staff_profile.created", "staff_profile.created"],
  ["staff_clearance_updated", "staff_clearance_updated"],
  ["fixture_cancelled", "fixture_cancelled"],
  ["fixture_rescheduled", "fixture_rescheduled"],
  ["court_block_created", "court_block_created"],
  ["court_block_deleted", "court_block_deleted"],
  ["incident_report_filed", "incident_report_filed"],
  ["incident_report_reviewed", "incident_report_reviewed"],
  ["venue_insurance_updated", "venue_insurance_updated"],
  ["issue_credit", "issue_credit"],
  ["revoke_credit", "revoke_credit"],
  ["membership_granted", "membership_granted"],
  ["membership_manual_grant", "membership_manual_grant"],
  ["membership_subscribed", "membership_subscribed"],
  ["membership_cancelled", "membership_cancelled"],
  ["membership_admin_cancelled", "membership_admin_cancelled"],
  ["membership_cancel_scheduled", "membership_cancel_scheduled"],
  ["membership_admin_override", "membership_admin_override"],
  ["membership_plan_created", "membership_plan_created"],
  ["membership_plan_updated", "membership_plan_updated"],
  ["spot_admin_added", "spot_admin_added"],
  ["spot_cancelled", "spot_cancelled"],
  ["waitlist_promoted", "waitlist_promoted"],
  ["waitlist_manually_promoted", "waitlist_manually_promoted"],
  ["player_checked_in", "player_checked_in"],
  ["no_show_marked", "no_show_marked"],
  ["camp_registration", "camp_registration"],
  ["camp_registration_cancelled", "camp_registration_cancelled"],
  ["camp_registration_updated", "camp_registration_updated"],
  ["camp_day_checkin", "camp_day_checkin"],
  ["youth_pii_exported", "youth_pii_exported"],
  ["youth_pii_anonymized", "youth_pii_anonymized"],
  ["youth_pii_deletion_requested", "youth_pii_deletion_requested"],
  ["youth_pii_list_accessed", "youth_pii_list_accessed"],
  ["youth_player_roster_accessed", "youth_player_roster_accessed"],
  ["auto_policy_apply", "auto_policy_apply"],
  ["weather_cancellation_credits", "weather_cancellation_credits"],
];

function ActorSearch({ value, onChange }: { value: string; onChange: (clerkId: string, name: string) => void }) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const { getToken } = useAuth();
  const ref = useRef<HTMLDivElement>(null);

  const { data: results } = useQuery<UserSearchResult[]>({
    queryKey: ["user-search", text],
    enabled: text.length >= 2,
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/users?q=${encodeURIComponent(text)}&limit=10`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return [];
      return res.json();
    },
  });

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function clear() {
    setText("");
    onChange("", "");
    setOpen(false);
  }

  return (
    <div className="relative" ref={ref}>
      <div className="flex gap-1">
        <Input
          placeholder="Type a name to search…"
          value={text}
          onChange={e => { setText(e.target.value); setOpen(true); }}
          onFocus={() => text.length >= 2 && setOpen(true)}
          className="text-sm"
        />
        {(text || value) && (
          <Button variant="ghost" size="sm" onClick={clear} className="px-2">✕</Button>
        )}
      </div>
      {value && !open && (
        <p className="text-xs text-primary mt-1">Filtering by: {text || value.slice(0, 16) + "…"}</p>
      )}
      {open && results && results.length > 0 && (
        <div className="absolute z-50 mt-1 w-full bg-background border rounded-md shadow-lg max-h-48 overflow-auto">
          {results.map(u => {
            const name = [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email;
            return (
              <button
                key={u.id}
                className="w-full text-left px-3 py-2 text-sm hover:bg-muted/60 flex flex-col"
                onClick={() => {
                  setText(name);
                  onChange(u.clerkId, name);
                  setOpen(false);
                }}
              >
                <span>{name}</span>
                <span className="text-xs text-muted-foreground">{u.email}</span>
              </button>
            );
          })}
        </div>
      )}
      {open && text.length >= 2 && (!results || results.length === 0) && (
        <div className="absolute z-50 mt-1 w-full bg-background border rounded-md shadow p-3 text-sm text-muted-foreground">
          No users found
        </div>
      )}
    </div>
  );
}

export default function AdminAuditLog() {
  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const { getToken } = useAuth();

  const [entityType, setEntityType] = useState("");
  const [action, setAction] = useState("");
  const [actorClerkId, setActorClerkId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [limit, setLimit] = useState(50);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [exporting, setExporting] = useState(false);


  const params = new URLSearchParams();
  if (entityType) params.set("entityType", entityType);
  if (action) params.set("action", action);
  if (actorClerkId) params.set("actorClerkId", actorClerkId);
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);
  params.set("limit", String(limit));

  const { data: entries, isLoading } = useQuery<AuditLogEntry[]>({
    queryKey: ["audit-log", entityType, action, actorClerkId, startDate, endDate, limit],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/audit-log?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const isSuperAdmin = (profile?.role === "admin" || profile?.adminLevel === "super" || profile?.adminLevel === "admin") && (profile as any)?.adminLevel === "super";

  if (profileLoading) return <Layout><div className="p-12"><Skeleton className="h-96" /></div></Layout>;
  if (!isSuperAdmin) return <Redirect to="/admin" />;

  function toggleExpand(id: number) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function formatJson(str: string | null) {
    if (!str) return null;
    try { return JSON.stringify(JSON.parse(str), null, 2); } catch { return str; }
  }

  async function handleExportCsv() {
    setExporting(true);
    try {
      const token = await getToken();
      const csvParams = new URLSearchParams(params);
      csvParams.set("limit", "1000");
      csvParams.set("format", "csv");
      const res = await fetch(`${API_BASE}/admin/audit-log?${csvParams}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12">
        <a href="/admin" className="text-sm text-muted-foreground hover:text-foreground mb-4 block">← Admin</a>
        <div className="flex items-start justify-between mb-2">
          <div>
            <h1 className="text-4xl font-bold font-sans uppercase tracking-tight text-primary">Audit Log</h1>
            <p className="text-muted-foreground mt-1">Immutable record of all significant actions across the system. Super Admin access only.</p>
          </div>
          <Button variant="outline" size="sm" onClick={handleExportCsv} disabled={exporting} className="mt-1">
            {exporting ? "Exporting…" : "Export CSV"}
          </Button>
        </div>

        <Card className="mb-6 mt-6">
          <CardContent className="pt-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <Label>Entity Type</Label>
                <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={entityType} onChange={e => setEntityType(e.target.value)}>
                  <option value="">All types</option>
                  {ALL_ENTITY_TYPES.map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label>Action</Label>
                <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={action} onChange={e => setAction(e.target.value)}>
                  <option value="">All actions</option>
                  {ALL_ACTIONS.map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label>Actor</Label>
                <ActorSearch
                  value={actorClerkId}
                  onChange={(clerkId) => setActorClerkId(clerkId)}
                />
              </div>
              <div className="space-y-1">
                <Label>Start date</Label>
                <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>End date</Label>
                <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Limit</Label>
                <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={limit} onChange={e => setLimit(Number(e.target.value))}>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={200}>200</option>
                </select>
              </div>
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="space-y-3">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-16" />)}</div>
        ) : !entries?.length ? (
          <Card><CardContent className="py-12 text-center text-muted-foreground">No audit log entries found.</CardContent></Card>
        ) : (
          <div className="space-y-2">
            {entries.map(entry => (
              <Card key={entry.id} className="overflow-hidden">
                <div
                  className="px-4 py-3 flex items-start justify-between gap-4 cursor-pointer hover:bg-muted/20"
                  onClick={() => toggleExpand(entry.id)}
                >
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <Badge className={`text-xs flex-shrink-0 mt-0.5 ${actionColor(entry.action)}`}>
                      {entry.action}
                    </Badge>
                    <div className="min-w-0">
                      <p className="text-sm font-medium leading-snug">{entry.summary}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        <span className="font-medium text-foreground/70">{entry.actorName}</span>
                        {entry.ipAddress && <span className="ml-2 opacity-60">· {entry.ipAddress}</span>}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {format(new Date(entry.createdAt), "MMM d, h:mm a")}
                    </span>
                    {(entry.before || entry.after) && (
                      <span className="text-xs text-muted-foreground">{expanded.has(entry.id) ? "▲" : "▼"}</span>
                    )}
                  </div>
                </div>
                {expanded.has(entry.id) && (entry.before || entry.after) && (
                  <div className="px-4 pb-3 border-t">
                    <p className="text-xs text-muted-foreground font-medium mt-2 mb-2">Details</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {entry.before && (
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Before</p>
                          <pre className="text-xs bg-muted/40 rounded p-2 overflow-auto max-h-48">{formatJson(entry.before)}</pre>
                        </div>
                      )}
                      {entry.after && (
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">After</p>
                          <pre className="text-xs bg-muted/40 rounded p-2 overflow-auto max-h-48">{formatJson(entry.after)}</pre>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
