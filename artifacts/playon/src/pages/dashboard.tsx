import React, { useContext, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useGetMyProfile } from "@workspace/api-client-react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { WaiverModal } from "@/components/waiver-modal";
import { Layout } from "@/components/layout";
import { DashboardTabContext } from "@/contexts/dashboard-tab-context";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format } from "date-fns";
import { formatEastern } from "@/lib/timezone";
import {
  RefreshCw, Users, CalendarDays, AlertCircle, Flag, Baby,
  Trophy, ShieldCheck, ChevronRight, QrCode, ArrowRight,
  Wallet, UserPlus, BookOpen, Clipboard, Phone, X, GraduationCap, CheckCircle2,
  Clock, ThumbsUp, ThumbsDown, HeartPulse, DollarSign, CalendarX,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { InlinePaymentDialog } from "@/components/inline-payment-dialog";
import { EmptyState } from "@/components/empty-state";

interface ReEnrollSuggestion {
  previousRegistrationId: number;
  userId: string;
  playerClerkId: string;
  programType: string;
  programId: number;
  programName: string;
  lastRegisteredAt: string;
  prefillHint: { programType: string; programId: number; teamId?: number };
}

interface StaffDashboardData {
  upcomingAssignments: Array<{
    id: number;
    role: string;
    entityType: string;
    entityId: number;
    startAt: string | null;
    endAt: string | null;
    status: string;
    compensationAmount: string | null;
  }>;
  upcomingFixtures: Array<{
    id: number;
    entityType: string;
    entityId: number;
    homeTeamId: number | null;
    awayTeamId: number | null;
    scheduledAt: string | null;
    status: string;
    round: number | null;
  }>;
  teamRoster: Array<{
    teamId: number;
    teamName: string;
    memberCount: number;
    members: Array<{ userId: string; role: string; jerseyNumber: number | null }>;
  }>;
  openSubSlots: Array<{
    id: number;
    status: string;
    gameDate: string | null;
    notes: string | null;
    fixtureId: number | null;
  }>;
}

type RoleId = "player" | "parent" | "ref" | "coach" | "scorekeeper" | "team_manager" | "team_coach";
type DisplayRoleId = "player" | "parent" | "ref" | "coach" | "scorekeeper" | "my_team";

const ROLE_META: Record<RoleId, { label: string; emoji: string }> = {
  player:       { label: "Player",       emoji: "⚽" },
  parent:       { label: "Parent",       emoji: "👨‍👧" },
  ref:          { label: "Referee",      emoji: "🟨" },
  coach:        { label: "Coach",        emoji: "📋" },
  scorekeeper:  { label: "Scorekeeper",  emoji: "📊" },
  team_manager: { label: "My Team",      emoji: "🏆" },
  team_coach:   { label: "My Team",      emoji: "🏆" },
};

const DISPLAY_ROLE_META: Record<DisplayRoleId, { label: string; emoji: string }> = {
  player:      { label: "Player",       emoji: "⚽" },
  parent:      { label: "Parent",       emoji: "👨‍👧" },
  ref:         { label: "Referee",      emoji: "🟨" },
  coach:       { label: "Coach",        emoji: "📋" },
  scorekeeper: { label: "Scorekeeper",  emoji: "📊" },
  my_team:     { label: "My Team",      emoji: "🏆" },
};

function toDisplayRoles(roles: RoleId[]): DisplayRoleId[] {
  const out: DisplayRoleId[] = [];
  let addedMyTeam = false;
  for (const r of roles) {
    if (r === "team_manager" || r === "team_coach") {
      if (!addedMyTeam) { out.push("my_team"); addedMyTeam = true; }
    } else {
      out.push(r as DisplayRoleId);
    }
  }
  return out;
}

interface TeamDashboardData {
  teams: Array<{
    teamId: number;
    teamName: string;
    leagueId: number | null;
    confirmedCount: number;
    members: Array<{ userId: string; role: string; jerseyNumber: number | null }>;
    pendingCount: number;
    pendingFreeAgents: Array<{
      id: number;
      leagueId: number;
      userId: string;
      positions: string[];
      skillLevel: string | null;
      matchReasoning: string | null;
      user: { firstName: string | null; lastName: string | null; email: string } | null;
    }>;
    registration: {
      id: number;
      paymentStatus: string;
      totalAmount: string | null;
      amountPaid: string | null;
      balanceDue: string | null;
      balanceDueDate: string | null;
      depositPaid: boolean;
      depositAmount: string | null;
      blackoutDates: string[];
    } | null;
  }>;
  upcomingFixtures: Array<{
    id: number;
    entityType: string;
    entityId: number;
    homeTeamId: number | null;
    awayTeamId: number | null;
    scheduledAt: string | null;
    status: string;
    round: number | null;
  }>;
}

interface FreeAgentEntry {
  id: number;
  leagueId: number;
  leagueName: string;
  matchStatus: string;
  proposedTeamName: string | null;
  proposedAt: string | null;
  positions: string[];
  skillLevel: string | null;
  status: string;
}

interface HealthPacketEntry {
  registrationId: number;
  campId: number;
  campName: string;
  campStartDate: string;
  daysUntilCamp: number;
  playerName: string;
  isChild: boolean;
}

interface ActiveCheckIn {
  entityType: string;
  entityId: number;
  eventName: string | null;
  eventType: string | null;
  checkedInAt: string;
  endsAt: string | null;
  childName?: string;
}

interface TeamInviteEntry {
  id: number;
  token: string;
  teamId: number;
  teamName: string | null;
  role: string;
  expiresAt: string;
}

function statusBorderClass(status: string) {
  switch (status) {
    case "confirmed": return "border-l-4 border-l-green-500";
    case "pending":   return "border-l-4 border-l-amber-400";
    case "waitlisted":return "border-l-4 border-l-gray-400";
    case "cancelled": return "border-l-4 border-l-red-500";
    default:          return "border-l-4 border-l-border";
  }
}

function statusBadgeClass(status: string) {
  switch (status) {
    case "confirmed": return "bg-green-500/15 text-green-600 border-green-500/30";
    case "pending":   return "bg-amber-400/15 text-amber-600 border-amber-400/30";
    case "waitlisted":return "bg-gray-400/15 text-gray-500 border-gray-400/30";
    case "cancelled": return "bg-red-500/15 text-red-500 border-red-500/30";
    default:          return "";
  }
}

function dropinSpotBadge(paymentStatus: string, poolPrice: number | string | null): { label: string; status: string } {
  const price = Number(poolPrice ?? 0);
  if (paymentStatus === "refunded") return { label: "Refunded", status: "cancelled" };
  if (price > 0 && (paymentStatus === "unpaid" || paymentStatus === "payment_pending")) {
    return { label: "Pending Payment", status: "pending" };
  }
  return { label: "Confirmed", status: "confirmed" };
}

function matchStatusLabel(matchStatus: string, assignedStatus?: string) {
  // A "matched"/"assigned" entry is the confirmed terminal state
  if (assignedStatus === "assigned" || matchStatus === "matched") {
    return { label: "Confirmed — you're on the team!", color: "text-green-500", icon: CheckCircle2 };
  }
  switch (matchStatus) {
    case "unmatched":        return { label: "Searching for a team match…", color: "text-muted-foreground", icon: Clock };
    case "team_reviewing":   return { label: "Team is reviewing your profile", color: "text-amber-500", icon: Clock };
    case "player_reviewing": return { label: "Team offer waiting — action required", color: "text-primary", icon: AlertCircle };
    default:                 return { label: matchStatus, color: "text-muted-foreground", icon: Clock };
  }
}

function FreeAgentStatusCard({ entries, leagueId }: { entries: FreeAgentEntry[]; leagueId?: number }) {
  const { getToken } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const respond = useMutation({
    mutationFn: async ({ faId, faLeagueId, decision }: { faId: number; faLeagueId: number; decision: "accept" | "decline" }) => {
      const token = await getToken();
      const res = await fetch(`${import.meta.env.BASE_URL}api/leagues/${faLeagueId}/free-agents/${faId}/player-respond`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? "Failed"); }
      return res.json();
    },
    onSuccess: (data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["free-agent-status"] });
      toast({ title: vars.decision === "accept" ? "Joined team!" : "Offer declined", description: data.message });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (entries.length === 0) return null;

  return (
    <Section title="Free Agent Status" icon={Users}>
      <div className="space-y-3">
        {entries.map((fa) => {
          const { label, color, icon: StatusIcon } = matchStatusLabel(fa.matchStatus, fa.status);
          return (
            <div key={fa.id} className="bg-card rounded-xl border border-border p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="min-w-0">
                  <p className="font-semibold text-sm">{fa.leagueName}</p>
                  <div className={`flex items-center gap-1.5 mt-0.5 ${color}`}>
                    <StatusIcon className="h-3.5 w-3.5 shrink-0" />
                    <span className="text-xs">{label}</span>
                  </div>
                </div>
                {fa.positions.length > 0 && (
                  <span className="text-[11px] font-semibold bg-muted text-muted-foreground px-2 py-0.5 rounded-full capitalize">
                    {fa.positions.join(", ")}
                  </span>
                )}
              </div>
              {fa.matchStatus === "team_reviewing" && fa.proposedTeamName && (
                <p className="text-xs text-muted-foreground">Proposed to: <span className="font-medium text-foreground">{fa.proposedTeamName}</span></p>
              )}
              {fa.matchStatus === "player_reviewing" && fa.proposedTeamName && (
                <div className="mt-3 space-y-2">
                  <p className="text-sm font-medium"><span className="text-primary">{fa.proposedTeamName}</span> wants you on their team</p>
                  <div className="flex gap-2">
                    <Button size="sm" className="gap-1.5 text-xs flex-1" onClick={() => respond.mutate({ faId: fa.id, faLeagueId: fa.leagueId, decision: "accept" })} disabled={respond.isPending}>
                      <ThumbsUp className="h-3.5 w-3.5" /> Accept
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1.5 text-xs flex-1" onClick={() => respond.mutate({ faId: fa.id, faLeagueId: fa.leagueId, decision: "decline" })} disabled={respond.isPending}>
                      <ThumbsDown className="h-3.5 w-3.5" /> Decline
                    </Button>
                  </div>
                </div>
              )}
              {(fa.status === "assigned" || fa.matchStatus === "matched") && fa.proposedTeamName && (
                <p className="text-xs text-green-600 mt-2 font-medium">✓ Placed on <span className="underline">{fa.proposedTeamName}</span></p>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function HealthPacketCard({ entries }: { entries: HealthPacketEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <Section title="Health Packet Required" icon={HeartPulse}>
      <div className="space-y-2">
        {entries.map((e) => (
          <div key={e.registrationId} className="bg-card rounded-xl border border-amber-400/40 border-l-4 border-l-amber-400 p-4 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="font-semibold text-sm">{e.campName}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {e.isChild ? `For ${e.playerName} · ` : ""}
                {e.daysUntilCamp <= 7
                  ? <span className="text-amber-500 font-medium">{e.daysUntilCamp} day{e.daysUntilCamp !== 1 ? "s" : ""} until camp</span>
                  : `${e.daysUntilCamp} days until camp`}
              </p>
            </div>
            <Link href={`/camps/${e.campId}`}>
              <Button size="sm" variant="outline" className="shrink-0 text-amber-600 border-amber-400/60 hover:bg-amber-400/10 text-xs gap-1">
                <HeartPulse className="h-3.5 w-3.5" /> Submit
              </Button>
            </Link>
          </div>
        ))}
      </div>
    </Section>
  );
}

function TeamInviteCard({ invites }: { invites: TeamInviteEntry[] }) {
  const { getToken } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [localDismissed, setLocalDismissed] = useState<Set<number>>(new Set());

  const accept = useMutation({
    mutationFn: async ({ token }: { token: string }) => {
      const auth = await getToken();
      const res = await fetch(`${import.meta.env.BASE_URL}api/me/claim-team-invite`, {
        method: "POST",
        headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? "Failed"); }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["pending-team-invites"] });
      queryClient.invalidateQueries({ queryKey: ["team-dashboard"] });
      toast({ title: `Joined ${data.teamName ?? "the team"}!` });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const decline = useMutation({
    mutationFn: async ({ id }: { id: number }) => {
      const auth = await getToken();
      const res = await fetch(`${import.meta.env.BASE_URL}api/me/team-invites/${id}/decline`, {
        method: "POST",
        headers: { Authorization: `Bearer ${auth}` },
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? "Failed"); }
      return res.json();
    },
    onSuccess: (_, vars) => {
      setLocalDismissed((prev) => new Set(prev).add(vars.id));
      queryClient.invalidateQueries({ queryKey: ["pending-team-invites"] });
      toast({ title: "Invitation declined" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const visible = invites.filter((inv) => !localDismissed.has(inv.id));
  if (visible.length === 0) return null;

  return (
    <Section title="Team Invitations" icon={UserPlus}>
      <div className="space-y-3">
        {visible.map((inv) => (
          <div key={inv.id} className="bg-card rounded-xl border border-primary/30 border-l-4 border-l-primary p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0">
                <p className="font-semibold text-sm">{inv.teamName ?? `Team #${inv.teamId}`}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Role: <span className="capitalize font-medium text-foreground">{inv.role}</span>
                  {" · "}Expires {format(new Date(inv.expiresAt), "MMM d")}
                </p>
              </div>
              <button
                className="text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => decline.mutate({ id: inv.id })}
                aria-label="Decline"
                disabled={decline.isPending}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm" className="gap-1.5 text-xs flex-1"
                onClick={() => accept.mutate({ token: inv.token })}
                disabled={accept.isPending || decline.isPending}
              >
                <ThumbsUp className="h-3.5 w-3.5" /> Accept &amp; Join
              </Button>
              <Button
                size="sm" variant="outline" className="gap-1.5 text-xs"
                onClick={() => decline.mutate({ id: inv.id })}
                disabled={accept.isPending || decline.isPending}
              >
                <ThumbsDown className="h-3.5 w-3.5" /> Decline
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function QuickAction({ icon: Icon, label, href, onClick, color }: {
  icon: React.ElementType;
  label: string;
  href?: string;
  onClick?: () => void;
  color: string;
}) {
  const inner = (
    <div className="group flex flex-col items-center gap-2 p-4 rounded-xl bg-card border border-border hover:border-primary/40 hover:bg-primary/5 transition-all cursor-pointer text-center">
      <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center group-hover:bg-primary/10 transition-colors">
        <Icon className={`h-5 w-5 ${color}`} />
      </div>
      <span className="text-xs font-medium text-foreground leading-tight">{label}</span>
    </div>
  );
  if (onClick) {
    return <button type="button" onClick={onClick} className="text-left w-full">{inner}</button>;
  }
  return <Link href={href!}>{inner}</Link>;
}

// ── Hero card ─────────────────────────────────────────────────────────────────
function HeroCard({ label, title, subtitle, ctaLabel, ctaHref, ctaOnClick, badge }: {
  label: string;
  title: string;
  subtitle?: string;
  ctaLabel: string;
  ctaHref?: string;
  ctaOnClick?: () => void;
  badge?: string;
}) {
  const btn = (
    <Button size="sm" className="shrink-0 bg-primary hover:bg-primary/85 text-primary-foreground border-0 gap-1.5">
      {ctaLabel}
      <ArrowRight className="h-3.5 w-3.5" />
    </Button>
  );
  return (
    <div className="bg-primary/5 border border-primary/15 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
        <h2 className="text-lg font-bold text-foreground leading-tight">{title}</h2>
        {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
        {badge && (
          <span className="inline-block mt-2 text-[11px] font-semibold bg-amber-500/15 text-amber-600 border border-amber-500/30 px-2 py-0.5 rounded-full">{badge}</span>
        )}
      </div>
      {ctaOnClick
        ? <button type="button" onClick={ctaOnClick}>{btn}</button>
        : <Link href={ctaHref!}>{btn}</Link>
      }
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────
function Section({ title, icon: Icon, children, sectionRef }: {
  title?: string;
  icon?: React.ElementType;
  children: React.ReactNode;
  sectionRef?: React.RefObject<HTMLElement | null>;
}) {
  return (
    <section className="space-y-3" ref={sectionRef}>
      {title && (
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
          {Icon && <Icon className="h-4 w-4" />}
          {title}
        </h3>
      )}
      {children}
    </section>
  );
}

interface FamilyChild {
  youthUserId: number;
  firstName: string | null;
  lastName: string | null;
  relationship: string;
}

function childFullName(c: FamilyChild) {
  return [c.firstName, c.lastName].filter(Boolean).join(" ") || "Child";
}

function typeBadgeLabel(type: string) {
  return type.replace(/_/g, " ");
}

function programHref(programType: string, programId: number) {
  const typeMap: Record<string, string> = {
    league: "leagues",
    camp: "camps",
    drop_in: "dropins",
    tournament: "tournaments",
  };
  const segment = typeMap[programType] ?? `${programType}s`;
  return `/${segment}/${programId}`;
}

function ChildRegistrationsSection({ child, getToken }: { child: FamilyChild; getToken: () => Promise<string | null> }) {
  const { data, isLoading } = useQuery({
    queryKey: ["child-registrations", child.youthUserId],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${import.meta.env.BASE_URL}api/family-dashboard/child/${child.youthUserId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      return res.json() as Promise<{
        child: { id: number; firstName: string | null; lastName: string | null };
        registrations: Array<{ id: number; programType: string; programName: string; programId: number; status: string; paymentStatus: string; amountPaid: string; createdAt: string }>;
        campRegistrations: Array<{ id: number; campId: number; campName: string; startDate: string | null; endDate: string | null; status: string; paymentStatus: string; pricePaid: string | null; createdAt: string }>;
        dropinSpots: Array<{ id: number; dropinName: string; dropinId: number; startsAt: string; endsAt: string | null; status: string; paymentStatus: string; poolPrice: number; createdAt: string }>;
      }>;
    },
    staleTime: 60_000,
  });

  const allItems: Array<{ key: string; name: string; type: string; status: string; label?: string; href: string; date?: string }> = [];

  if (data) {
    for (const r of data.registrations) {
      allItems.push({
        key: `reg-${r.id}`,
        name: r.programName || `Program #${r.programId}`,
        type: r.programType,
        status: r.status,
        href: programHref(r.programType, r.programId),
      });
    }
    for (const cr of data.campRegistrations) {
      allItems.push({
        key: `camp-${cr.id}`,
        name: cr.campName || `Camp #${cr.campId}`,
        type: "camp",
        status: cr.status,
        href: `/camps/${cr.campId}`,
      });
    }
    for (const ds of data.dropinSpots) {
      const dsBadge = dropinSpotBadge(ds.paymentStatus, ds.poolPrice);
      allItems.push({
        key: `dropin-${ds.id}`,
        name: ds.dropinName || `Drop-in #${ds.dropinId}`,
        type: "drop_in",
        status: dsBadge.status,
        label: dsBadge.label,
        href: `/dropins/${ds.dropinId}`,
        date: ds.startsAt,
      });
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 pt-1">
        <Baby className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="text-sm font-semibold text-foreground">{childFullName(child)}</span>
        <span className="text-[11px] text-muted-foreground capitalize">· {child.relationship}</span>
      </div>
      {isLoading ? (
        <div className="space-y-2 pl-6">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : allItems.length === 0 ? (
        <p className="pl-6 text-xs text-muted-foreground">No current registrations</p>
      ) : (
        <div className="pl-6 space-y-2">
          {allItems.map((item) => (
            <Link key={item.key} href={item.href}>
              <div className={`bg-card rounded-xl border border-border overflow-hidden flex items-center justify-between px-4 py-3 gap-3 hover:border-primary/30 transition-colors ${statusBorderClass(item.status)}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                    <span className={`inline-flex items-center text-[11px] font-semibold uppercase px-2 py-0.5 rounded-full border ${statusBadgeClass(item.status)}`}>
                      {item.label ?? item.status}
                    </span>
                    <span className="text-[11px] text-muted-foreground uppercase font-medium">{typeBadgeLabel(item.type)}</span>
                  </div>
                  <p className="font-medium text-sm text-foreground leading-tight truncate">{item.name}</p>
                  {item.date && (
                    <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                      <CalendarDays className="h-3 w-3 shrink-0" />
                      {formatEastern(new Date(item.date), "EEE, MMM d 'at' h:mm a 'ET'")}
                    </p>
                  )}
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Player tab ────────────────────────────────────────────────────────────────
function PlayerTab({ registrations, campRegistrations, leagueRegistrations, tournamentRegistrations, dropinSpots, reEnrollSuggestions, isLoading, freeAgentStatuses, healthPackets, teamInvites, activeCheckIns, familyChildren, getToken }: {
  registrations: any[] | undefined;
  campRegistrations: any[] | undefined;
  leagueRegistrations: any[] | undefined;
  tournamentRegistrations: any[] | undefined;
  dropinSpots: any[] | undefined;
  reEnrollSuggestions: ReEnrollSuggestion[] | undefined;
  isLoading: boolean;
  freeAgentStatuses: FreeAgentEntry[];
  healthPackets: HealthPacketEntry[];
  teamInvites: TeamInviteEntry[];
  activeCheckIns: ActiveCheckIn[];
  familyChildren: FamilyChild[];
  getToken: () => Promise<string | null>;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [cancelSpot, setCancelSpot] = useState<{ id: number; name: string; startsAt: string } | null>(null);

  const cancelMutation = useMutation({
    mutationFn: async (spotId: number) => {
      const token = await getToken();
      const res = await fetch(`${import.meta.env.BASE_URL}api/dropins/spots/${spotId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to cancel spot");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-dropin-spots"] });
      toast({ title: "Spot cancelled", description: "Your drop-in spot has been cancelled." });
      setCancelSpot(null);
    },
    onError: (err: Error) => {
      toast({ title: "Could not cancel", description: err.message, variant: "destructive" });
      setCancelSpot(null);
    },
  });

  const isWithinWindow = cancelSpot
    ? (new Date(cancelSpot.startsAt).getTime() - Date.now()) / 60000 < 120
    : false;

  const waitlistedCamps = campRegistrations?.filter(r => r.status === "waitlisted") ?? [];
  const waitlistedLeagues = leagueRegistrations?.filter(r => r.status === "waitlisted") ?? [];
  const waitlistedTournaments = tournamentRegistrations?.filter(r => r.status === "waitlisted") ?? [];

  // "Next Up" hero: first confirmed league/camp/tournament reg OR earliest upcoming drop-in spot
  const nextReg = registrations?.find(r => r.status === "confirmed") ?? null;
  const nextSpot = (dropinSpots ?? []).filter(s => !s.waitlisted)[0] ?? null;
  const nextRegMs  = nextReg  ? new Date(nextReg.createdAt).getTime()  : Infinity;
  const nextSpotMs = nextSpot ? new Date(nextSpot.startsAt).getTime() : Infinity;
  const useSpotAsHero = nextSpot && nextSpotMs <= nextRegMs;

  const confirmedCount = (registrations?.filter(r => r.status === "confirmed").length ?? 0);
  const dropinCount = (dropinSpots ?? []).filter(s => !s.waitlisted).length;

  const heroTitle = useSpotAsHero
    ? (nextSpot!.dropinName || `Drop-in #${nextSpot!.dropinId}`)
    : nextReg
    ? (nextReg.programName || `Program #${nextReg.programId}`)
    : "Nothing upcoming right now";
  const heroSub = useSpotAsHero
    ? `drop-in · ${formatEastern(new Date(nextSpot!.startsAt), "EEE, MMM d 'at' h:mm a 'ET'")}`
    : nextReg
    ? `${nextReg.programType.replace("_", " ")} · registered ${format(new Date(nextReg.createdAt), "MMM d, yyyy")}`
    : "Browse leagues, drop-ins, and camps to get started.";
  const heroLabel = (useSpotAsHero || nextReg) ? "Next Up" : "Get Started";
  const heroHref = useSpotAsHero
    ? `/dropins/${nextSpot!.dropinId}`
    : nextReg
    ? programHref(nextReg.programType, nextReg.programId)
    : "/leagues";
  const heroCtaLabel = (useSpotAsHero || nextReg) ? "View Program" : "Browse Programs";

  return (
    <div className="space-y-6">
      {/* Team invitations */}
      <TeamInviteCard invites={teamInvites} />

      {/* Checked in today */}
      {activeCheckIns.length > 0 && (
        <Section title="Checked In Today" icon={CheckCircle2}>
          <div className="space-y-2">
            {activeCheckIns.map((ci, i) => (
              <div key={i} className="bg-green-500/8 border border-green-500/25 border-l-4 border-l-green-500 rounded-xl p-4 flex items-center gap-4">
                <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm text-foreground">{ci.eventName ?? "Event"}</p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    {ci.eventType && (
                      <span className="text-[11px] font-semibold uppercase bg-green-500/15 text-green-700 dark:text-green-400 px-2 py-0.5 rounded-full">
                        {ci.eventType}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Checked in {formatEastern(new Date(ci.checkedInAt), "h:mm a 'ET'")}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Hero */}
      <HeroCard label={heroLabel} title={heroTitle} subtitle={heroSub} ctaLabel={heroCtaLabel} ctaHref={heroHref} />

      {/* Quick actions */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <QuickAction icon={BookOpen}  label="Browse Programs"  href="/leagues"   color="text-blue-500" />
        <QuickAction icon={QrCode}    label="My QR Code"       href="/profile/qr" color="text-purple-500" />
        <QuickAction icon={RefreshCw} label="Re-enroll"        href="/me?tab=activity" color="text-green-500" />
        <QuickAction icon={CalendarDays} label="Drop-ins"      href="/dropins"   color="text-amber-500" />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-card rounded-xl border border-border p-4 border-l-4 border-l-green-500">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Active</p>
          <p className="text-2xl font-bold">{confirmedCount}</p>
          <p className="text-xs text-muted-foreground mt-0.5">confirmed registrations</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-4 border-l-4 border-l-purple-500">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Drop-ins</p>
          <p className="text-2xl font-bold">{dropinCount}</p>
          <p className="text-xs text-muted-foreground mt-0.5">upcoming sessions</p>
        </div>
      </div>

      {/* Waitlist positions — camps, leagues, tournaments */}
      {(waitlistedCamps.length > 0 || waitlistedLeagues.length > 0 || waitlistedTournaments.length > 0) && (
        <Section title="Waitlist" icon={Clock}>
          <div className="space-y-2">
            {waitlistedCamps.map((cr: any) => (
              <div key={`camp-${cr.id}`} className="bg-card rounded-xl border border-amber-200 dark:border-amber-800 border-l-4 border-l-amber-400 p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="inline-flex items-center text-[11px] font-semibold uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 border border-amber-300 dark:border-amber-700">Waitlisted</span>
                    <span className="text-[11px] text-muted-foreground uppercase font-medium">Camp</span>
                  </div>
                  <h4 className="font-semibold text-foreground">{cr.campName || `Camp #${cr.campId}`}</h4>
                  {cr.campStartDate && <p className="text-xs text-muted-foreground mt-0.5">Starts {format(new Date(cr.campStartDate + "T12:00:00"), "MMM d, yyyy")}</p>}
                </div>
                {cr.waitlistPosition != null && (
                  <div className="flex-shrink-0 text-center">
                    <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">#{cr.waitlistPosition}</p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">in line</p>
                  </div>
                )}
              </div>
            ))}
            {waitlistedLeagues.map((lr: any) => (
              <div key={`league-${lr.id}`} className="bg-card rounded-xl border border-amber-200 dark:border-amber-800 border-l-4 border-l-amber-400 p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="inline-flex items-center text-[11px] font-semibold uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 border border-amber-300 dark:border-amber-700">Waitlisted</span>
                    <span className="text-[11px] text-muted-foreground uppercase font-medium">League</span>
                  </div>
                  <h4 className="font-semibold text-foreground">{lr.leagueName || `League #${lr.leagueId}`}</h4>
                  {lr.leagueStartDate && <p className="text-xs text-muted-foreground mt-0.5">Starts {format(new Date(lr.leagueStartDate + "T12:00:00"), "MMM d, yyyy")}</p>}
                  {lr.teamName && <p className="text-xs text-muted-foreground">Team: {lr.teamName}</p>}
                </div>
                {lr.waitlistPosition != null && (
                  <div className="flex-shrink-0 text-center">
                    <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">#{lr.waitlistPosition}</p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">in line</p>
                  </div>
                )}
              </div>
            ))}
            {waitlistedTournaments.map((tr: any) => (
              <div key={`tournament-${tr.id}`} className="bg-card rounded-xl border border-amber-200 dark:border-amber-800 border-l-4 border-l-amber-400 p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="inline-flex items-center text-[11px] font-semibold uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 border border-amber-300 dark:border-amber-700">Waitlisted</span>
                    <span className="text-[11px] text-muted-foreground uppercase font-medium">Tournament</span>
                  </div>
                  <h4 className="font-semibold text-foreground">{tr.tournamentName || `Tournament #${tr.tournamentId}`}</h4>
                  {tr.tournamentStartDate && <p className="text-xs text-muted-foreground mt-0.5">Starts {format(new Date(tr.tournamentStartDate + "T12:00:00"), "MMM d, yyyy")}</p>}
                  {tr.teamName && <p className="text-xs text-muted-foreground">Team: {tr.teamName}</p>}
                </div>
                {tr.waitlistPosition != null && (
                  <div className="flex-shrink-0 text-center">
                    <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">#{tr.waitlistPosition}</p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">in line</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Drop-in spots */}
      {dropinSpots && dropinSpots.length > 0 && (
        <Section title="My Drop-in Sessions" icon={CalendarDays}>
          <div className="space-y-3">
            {dropinSpots.map((spot: any) => {
              const badge = spot.waitlisted ? { label: "Waitlisted", status: "waitlisted" } : dropinSpotBadge(spot.paymentStatus, spot.poolPrice);
              return (
              <div key={spot.id} className={`bg-card rounded-xl border border-border overflow-hidden ${statusBorderClass(badge.status)}`}>
                <div className="flex flex-col sm:flex-row justify-between sm:items-center p-5 gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1.5">
                      <span className={`inline-flex items-center text-[11px] font-semibold uppercase px-2 py-0.5 rounded-full border ${statusBadgeClass(badge.status)}`}>
                        {badge.label}
                      </span>
                      <span className="text-[11px] text-muted-foreground uppercase font-medium">Drop-in</span>
                    </div>
                    <h4 className="font-semibold text-foreground">{spot.dropinName || `Drop-in #${spot.dropinId}`}</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {format(new Date(spot.startsAt), "EEE, MMM d")} &middot; {formatEastern(new Date(spot.startsAt), "h:mm a 'ET'")}{spot.endsAt ? ` – ${formatEastern(new Date(spot.endsAt), "h:mm a 'ET'")}` : ""}
                    </p>
                  </div>
                  <div className="flex sm:flex-col items-center sm:items-end gap-3 shrink-0">
                    <span className="text-[11px] text-muted-foreground uppercase">{spot.paymentStatus.replace("_", " ")}</span>
                    <div className="flex items-center gap-1">
                      <Link href={`/dropins/${spot.dropinId}`}>
                        <Button size="sm" variant="ghost" className="text-primary hover:text-primary h-8 text-xs gap-1">
                          Details <ChevronRight className="h-3.5 w-3.5" />
                        </Button>
                      </Link>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive h-8 text-xs gap-1"
                        onClick={() => setCancelSpot({ id: spot.id, name: spot.dropinName || `Drop-in #${spot.dropinId}`, startsAt: spot.startsAt })}
                      >
                        <X className="h-3.5 w-3.5" /> Cancel
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        </Section>
      )}

      <AlertDialog open={!!cancelSpot} onOpenChange={(open) => { if (!open) setCancelSpot(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel drop-in spot?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  You're about to cancel your spot for <span className="font-medium text-foreground">{cancelSpot?.name}</span>.
                </p>
                {isWithinWindow && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 p-3 text-amber-700 dark:text-amber-400 text-sm">
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>This session starts in less than 2 hours. Late cancellations may not be allowed by the organizer.</span>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelMutation.isPending}>Keep spot</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={cancelMutation.isPending}
              onClick={() => cancelSpot && cancelMutation.mutate(cancelSpot.id)}
            >
              {cancelMutation.isPending ? "Cancelling…" : "Cancel spot"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Registrations list */}
      <Section title="My Registrations" icon={Clipboard}>
        {isLoading ? (
          <div className="space-y-3">{[1,2].map(i => <Skeleton key={i} className="h-24 w-full" />)}</div>
        ) : registrations && registrations.length > 0 ? (
          <div className="space-y-3">
            {registrations.map(reg => (
              <div key={reg.id} className={`bg-card rounded-xl border border-border overflow-hidden ${statusBorderClass(reg.status)}`}>
                <div className="flex flex-col sm:flex-row justify-between sm:items-center p-5 gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1.5">
                      <span className={`inline-flex items-center text-[11px] font-semibold uppercase px-2 py-0.5 rounded-full border ${statusBadgeClass(reg.status)}`}>
                        {reg.status}
                      </span>
                      <span className="text-[11px] text-muted-foreground uppercase font-medium">{reg.programType.replace("_", " ")}</span>
                    </div>
                    <h4 className="font-semibold text-foreground">{reg.programName || `Program #${reg.programId}`}</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">Registered {format(new Date(reg.createdAt), "MMM d, yyyy")}</p>
                  </div>
                  <div className="flex sm:flex-col items-center sm:items-end gap-3 shrink-0">
                    <div className="text-right">
                      <p className="font-semibold text-foreground">${reg.amountPaid}</p>
                      <p className="text-[11px] text-muted-foreground uppercase">{reg.paymentStatus}</p>
                    </div>
                    <Link href={programHref(reg.programType, reg.programId)}>
                      <Button size="sm" variant="ghost" className="text-primary hover:text-primary h-8 text-xs gap-1">
                        Details <ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Trophy}
            title="No registrations yet"
            description="You're not signed up for any programs. Browse leagues, drop-ins, camps, and tournaments to get started."
            action={{ label: "Find a program", onClick: () => window.location.assign("/leagues") }}
            className="rounded-xl border border-dashed border-border"
          />
        )}
      </Section>

      {/* My Kids */}
      {familyChildren.length > 0 && (
        <Section title="My Kids" icon={Baby}>
          <div className="space-y-4">
            {familyChildren.map((child) => (
              <ChildRegistrationsSection key={child.youthUserId} child={child} getToken={getToken} />
            ))}
          </div>
        </Section>
      )}

      {/* Free agent status */}
      <FreeAgentStatusCard entries={freeAgentStatuses} />

      {/* Health packet prompts */}
      <HealthPacketCard entries={healthPackets.filter(e => !e.isChild)} />

      {/* Re-enroll suggestions */}
      {reEnrollSuggestions && reEnrollSuggestions.length > 0 && (
        <Section title="Register Again" icon={RefreshCw}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {reEnrollSuggestions.slice(0, 6).map((s) => {
              const href =
                `/re-enroll?programType=${encodeURIComponent(s.programType)}` +
                `&programId=${s.programId}` +
                `&programName=${encodeURIComponent(s.programName)}` +
                `&playerClerkId=${encodeURIComponent(s.playerClerkId)}` +
                (s.prefillHint.teamId ? `&teamId=${s.prefillHint.teamId}` : "");
              return (
                <div key={s.previousRegistrationId} className="bg-card rounded-xl border border-border p-4 flex flex-col gap-3">
                  <div>
                    <span className="text-[11px] font-semibold text-muted-foreground uppercase">{s.programType.replace("_", " ")}</span>
                    <h4 className="font-semibold leading-tight mt-0.5">{s.programName}</h4>
                    <p className="text-xs text-muted-foreground mt-1">Last played {format(new Date(s.lastRegisteredAt), "MMM yyyy")}</p>
                  </div>
                  <Link href={href}>
                    <Button size="sm" className="w-full">Register Again</Button>
                  </Link>
                </div>
              );
            })}
          </div>
        </Section>
      )}
    </div>
  );
}

// ── Parent tab ────────────────────────────────────────────────────────────────
function ParentTab() {
  const { getToken } = useAuth();

  const { data: familyData, isLoading } = useQuery({
    queryKey: ["family-dashboard"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${import.meta.env.BASE_URL}api/family-dashboard`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      return res.json() as Promise<{
        children: Array<{
          youthUserId: number;
          firstName: string | null;
          lastName: string | null;
          relationship: string;
        }>;
      }>;
    },
    staleTime: 60_000,
  });

  const children = familyData?.children ?? [];

  return (
    <div className="space-y-6">
      <Link href="/me?tab=family">
        <div className="group flex items-center gap-4 rounded-xl bg-primary/5 border border-primary/15 hover:border-primary/30 hover:bg-primary/10 transition-all cursor-pointer p-6">
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
            <Baby className="h-6 w-6 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-base text-foreground leading-tight">Manage your family →</p>
            <p className="text-sm text-muted-foreground mt-0.5">View schedules, balances, check-in QR codes, and add children.</p>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
        </div>
      </Link>

      {isLoading ? (
        <Section title="Children" icon={Baby}>
          <div className="space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        </Section>
      ) : children.length > 0 ? (
        <Section title="Children" icon={Baby}>
          <div className="space-y-4">
            {children.map((child) => (
              <div key={child.youthUserId} className="bg-card rounded-xl border border-border p-4">
                <ChildRegistrationsSection child={child} getToken={getToken} />
              </div>
            ))}
          </div>
        </Section>
      ) : null}
    </div>
  );
}

// ── Training banner ────────────────────────────────────────────────────────────
type TrainingStatus = {
  isComplete: boolean;
  trainingCompletedAt: string | null;
  requiredSections: number[];
  progress: Record<string, { passed: boolean; score: number; total: number; completedAt: string }>;
};

function TrainingBanner({ trainingStatus }: { trainingStatus: TrainingStatus | undefined }) {
  if (trainingStatus === undefined) return null;

  if (trainingStatus.isComplete) {
    const completedDate = trainingStatus.trainingCompletedAt
      ? format(new Date(trainingStatus.trainingCompletedAt), "MMM d, yyyy")
      : null;
    return (
      <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-4 flex items-center gap-3">
        <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
        <div className="min-w-0">
          <p className="font-semibold text-emerald-700 text-sm">Training Complete</p>
          {completedDate && (
            <p className="text-xs text-muted-foreground mt-0.5">Certified {completedDate}</p>
          )}
        </div>
      </div>
    );
  }

  // Find the next incomplete required section to deep-link
  const nextSection = trainingStatus.requiredSections.find(
    (s) => !trainingStatus.progress[String(s)]?.passed
  );
  const linkTarget = nextSection ? `/staff/training/${nextSection}` : "/staff/training";
  const hasSomeProgress = trainingStatus.requiredSections.some(
    (s) => trainingStatus.progress[String(s)]
  );

  return (
    <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <GraduationCap className="h-5 w-5 text-amber-500 shrink-0" />
        <div className="min-w-0">
          <p className="font-semibold text-amber-700 text-sm">Complete Your Training</p>
          <p className="text-xs text-muted-foreground mt-0.5">Review the rules and pass the knowledge check to finish your orientation.</p>
        </div>
      </div>
      <Link href={linkTarget}>
        <Button size="sm" className="bg-amber-500 hover:bg-amber-600 text-white shrink-0 gap-1.5">
          {hasSomeProgress ? "Continue" : "Start"} <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </Link>
    </div>
  );
}

// ── Referee tab ───────────────────────────────────────────────────────────────
function RefTab({ staffData, isLoading, claimingSlotId, claimedSlotIds, claimError, claimSuccessDate, onClaim, trainingStatus }: {
  staffData: StaffDashboardData | undefined;
  isLoading: boolean;
  claimingSlotId: number | null;
  claimedSlotIds: Set<number>;
  claimError: string | null;
  claimSuccessDate: string | null;
  onClaim: (id: number, gameDate: string | null) => void;
  trainingStatus: TrainingStatus | undefined;
}) {
  const slotsRef = useRef<HTMLDivElement>(null);
  const gamesRef = useRef<HTMLDivElement>(null);
  const scrollToSlots = () => slotsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  const scrollToGames = () => gamesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  // Sort open slots ascending by game date for nearest-first
  const openSlots = [...(staffData?.openSubSlots.filter(s => !claimedSlotIds.has(s.id)) ?? [])]
    .sort((a, b) => {
      if (!a.gameDate && !b.gameDate) return 0;
      if (!a.gameDate) return 1;
      if (!b.gameDate) return -1;
      return new Date(a.gameDate).getTime() - new Date(b.gameDate).getTime();
    });

  // Sort fixtures ascending by scheduledAt
  const sortedFixtures = [...(staffData?.upcomingFixtures ?? [])]
    .sort((a, b) => {
      if (!a.scheduledAt && !b.scheduledAt) return 0;
      if (!a.scheduledAt) return 1;
      if (!b.scheduledAt) return -1;
      return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
    });

  const nextSlot    = openSlots[0] ?? null;
  const nextFixture = sortedFixtures[0] ?? null;

  const heroTitle = nextSlot
    ? `Open slot — ${nextSlot.gameDate ? formatEastern(new Date(nextSlot.gameDate), "EEE MMM d 'at' h:mm a 'ET'") : "Date TBD"}`
    : nextFixture
    ? `Next game: ${nextFixture.round ? `Round ${nextFixture.round}` : "Fixture"} #${nextFixture.id}`
    : "No open slots or upcoming games";
  const heroSub = nextSlot
    ? nextSlot.notes ?? "Claim this slot to confirm your assignment."
    : nextFixture
    ? nextFixture.scheduledAt ? formatEastern(new Date(nextFixture.scheduledAt), "EEE, MMM d 'at' h:mm a 'ET'") : undefined
    : "Check back soon for upcoming fixtures.";

  return (
    <div className="space-y-6">
      {/* Training banner */}
      <TrainingBanner trainingStatus={trainingStatus} />

      {/* Hero */}
      <HeroCard
        label={nextSlot ? "Open Sub Slot" : nextFixture ? "Next Assignment" : "All Clear"}
        title={heroTitle}
        subtitle={heroSub}
        ctaLabel={nextSlot ? "View Slots" : "View Assignments"}
        ctaOnClick={nextSlot ? scrollToSlots : scrollToGames}
      />

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-3">
        <QuickAction icon={Flag}         label="View Open Slots"  onClick={scrollToSlots} color="text-orange-500" />
        <QuickAction icon={CalendarDays} label="My Assignments"   onClick={scrollToGames} color="text-blue-500" />
      </div>

      {/* Claim success / error banner */}
      {claimSuccessDate && (
        <div className="p-3 rounded-xl bg-green-500/10 border border-green-500/30 text-green-600 text-sm flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 shrink-0" />
          You're confirmed for {claimSuccessDate}. Check your upcoming games below.
        </div>
      )}
      {claimError && (
        <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-sm flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {claimError}
        </div>
      )}

      {/* Open sub slots */}
      <Section title="Open Sub Slots" icon={Flag}>
        <div ref={slotsRef} className="space-y-2">
          {isLoading ? (
            [1,2].map(i => <Skeleton key={i} className="h-16 w-full" />)
          ) : openSlots.length > 0 ? openSlots.map((slot) => (
            <div key={slot.id} className="bg-card rounded-xl border border-border border-l-4 border-l-green-500 flex items-center justify-between p-4 gap-4">
              <div className="min-w-0">
                <p className="font-medium text-sm">
                  {slot.gameDate ? formatEastern(new Date(slot.gameDate), "EEE MMM d, h:mm a 'ET'") : "Date TBD"}
                </p>
                {slot.notes && <p className="text-xs text-muted-foreground mt-0.5">{slot.notes}</p>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] font-semibold text-green-600 bg-green-500/15 border border-green-500/30 px-2 py-0.5 rounded-full">OPEN</span>
                <Button size="sm" onClick={() => onClaim(slot.id, slot.gameDate)} disabled={claimingSlotId !== null}>
                  {claimingSlotId === slot.id ? "Claiming…" : "Claim"}
                </Button>
              </div>
            </div>
          )) : (
            <EmptyState
              icon={CalendarX}
              title="No open slots right now"
              description="When a slot opens up you'll get a text — check back here to claim it."
              className="rounded-xl border border-dashed border-border"
            />
          )}
        </div>
      </Section>

      {/* Upcoming assigned games */}
      <Section title="Upcoming Assigned Games" icon={CalendarDays}>
        <div ref={gamesRef} className="space-y-2">
          {isLoading ? (
            [1,2].map(i => <Skeleton key={i} className="h-16 w-full" />)
          ) : sortedFixtures.length > 0 ? sortedFixtures.map((fixture) => (
            <div key={fixture.id} className="bg-card rounded-xl border border-border flex items-center justify-between p-4 gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-[11px] font-semibold text-muted-foreground uppercase bg-muted px-2 py-0.5 rounded-full shrink-0">{fixture.entityType}</span>
                <div>
                  <p className="font-medium text-sm">{fixture.round ? `Round ${fixture.round}` : "Fixture"} #{fixture.id}</p>
                  <p className="text-xs text-muted-foreground uppercase">{fixture.status}</p>
                </div>
              </div>
              {fixture.scheduledAt && (
                <p className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                  {formatEastern(new Date(fixture.scheduledAt), "EEE MMM d, h:mm a 'ET'")}
                </p>
              )}
            </div>
          )) : (
            <EmptyState
              icon={CalendarDays}
              title="No upcoming games"
              description="You have no assigned games coming up. New assignments will appear here."
              className="rounded-xl border border-dashed border-border"
            />
          )}
        </div>
      </Section>
    </div>
  );
}

// ── My Team tab (unified for team_manager + team_coach + captain) ────────────
function MyTeamTab({ teamDashData, isLoading, isTeamManager }: {
  teamDashData: TeamDashboardData | undefined;
  isLoading: boolean;
  isTeamManager: boolean;
}) {
  const { getToken } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const rosterRef   = useRef<HTMLDivElement>(null);
  const fixturesRef = useRef<HTMLDivElement>(null);
  const scrollToRoster   = () => rosterRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  const scrollToFixtures = () => fixturesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  const [newDateByTeam, setNewDateByTeam] = useState<Record<number, string>>({});
  const [paymentData, setPaymentData] = useState<{
    clientSecret: string;
    publishableKey: string;
    amount: number;
    label: string;
  } | null>(null);

  const totalPendingFAs = teamDashData?.teams.reduce((sum, t) => sum + t.pendingFreeAgents.length, 0) ?? 0;

  async function startDepositPayment(regId: number, payBalance: boolean) {
    const token = await getToken();
    const res = await fetch(`${import.meta.env.BASE_URL}api/checkout/deposit`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ offeringType: "league", registrationId: regId, payBalance }),
    });
    const data = await res.json();
    if (!res.ok || !data.clientSecret) {
      toast({ title: "Payment error", description: data.error ?? "Could not start payment", variant: "destructive" });
      return;
    }
    setPaymentData({
      clientSecret: data.clientSecret,
      publishableKey: data.publishableKey,
      amount: data.amount,
      label: payBalance ? "Pay Balance" : "Pay Deposit",
    });
  }

  const updateBlackout = useMutation({
    mutationFn: async ({ regId, blackoutDates }: { regId: number; blackoutDates: string[] }) => {
      const token = await getToken();
      const res = await fetch(`${import.meta.env.BASE_URL}api/me/team-registrations/${regId}/blackout-dates`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ blackoutDates }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? "Failed"); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-dashboard"] });
      toast({ title: "Blackout dates updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const respond = useMutation({
    mutationFn: async ({ faId, leagueId, decision }: { faId: number; leagueId: number; decision: "approve" | "decline" }) => {
      const token = await getToken();
      const res = await fetch(`${import.meta.env.BASE_URL}api/leagues/${leagueId}/free-agents/${faId}/team-respond`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? "Failed"); }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["team-dashboard"] });
      toast({ title: "Response sent", description: data.message });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const sortedFixtures = [...(teamDashData?.upcomingFixtures ?? [])]
    .sort((a, b) => {
      if (!a.scheduledAt && !b.scheduledAt) return 0;
      if (!a.scheduledAt) return 1;
      if (!b.scheduledAt) return -1;
      return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
    });
  const nextFixture = sortedFixtures[0] ?? null;

  const heroTitle = teamDashData && teamDashData.teams.length > 0
    ? `${teamDashData.teams[0].teamName}${teamDashData.teams.length > 1 ? ` +${teamDashData.teams.length - 1} more` : ""}`
    : "Manage your team";
  const heroSub = teamDashData && teamDashData.teams.length > 0
    ? `${teamDashData.teams.reduce((s, t) => s + t.confirmedCount, 0)} active players · ${totalPendingFAs > 0 ? `${totalPendingFAs} free agent${totalPendingFAs > 1 ? "s" : ""} awaiting review` : "no pending free agents"}`
    : "Register a team in a league to start managing your roster.";

  return (
    <>
    <div className="space-y-6">
      <HeroCard
        label={isTeamManager ? "Team Manager" : "Team Coach"}
        title={heroTitle}
        subtitle={heroSub}
        ctaLabel="View Fixtures"
        ctaOnClick={nextFixture ? scrollToFixtures : undefined}
        ctaHref={nextFixture ? undefined : "/leagues"}
        badge={totalPendingFAs > 0 ? `${totalPendingFAs} free agent${totalPendingFAs > 1 ? "s" : ""} need review` : undefined}
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <QuickAction icon={Users}        label="Team Roster"       onClick={scrollToRoster}   color="text-blue-500" />
        <QuickAction icon={Trophy}       label="Fixtures"          onClick={scrollToFixtures} color="text-amber-500" />
        <QuickAction icon={UserPlus}     label="Invite Players"    href="/leagues"            color="text-green-500" />
        {isTeamManager && <QuickAction icon={BookOpen}  label="Register a Team"  href="/leagues"  color="text-primary" />}
      </div>

      {/* Free agent approval queue */}
      {(teamDashData?.teams ?? []).some(t => t.pendingFreeAgents.length > 0) && (
        <Section title="Free Agent Review Queue" icon={UserPlus}>
          <div className="space-y-3">
            {(teamDashData?.teams ?? []).map(team =>
              team.pendingFreeAgents.map(fa => (
                <div key={fa.id} className="bg-card rounded-xl border border-primary/30 border-l-4 border-l-primary p-4">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm">{fa.user?.firstName} {fa.user?.lastName}</p>
                      <p className="text-xs text-muted-foreground">{fa.user?.email} · {team.teamName}</p>
                    </div>
                    {fa.positions.length > 0 && (
                      <span className="text-[11px] font-semibold bg-muted text-muted-foreground px-2 py-0.5 rounded-full capitalize shrink-0">
                        {fa.positions.join(", ")}
                      </span>
                    )}
                  </div>
                  {fa.matchReasoning && (
                    <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{fa.matchReasoning}</p>
                  )}
                  <div className="flex gap-2">
                    <Button size="sm" className="gap-1.5 text-xs flex-1" onClick={() => respond.mutate({ faId: fa.id, leagueId: fa.leagueId, decision: "approve" })} disabled={respond.isPending}>
                      <ThumbsUp className="h-3.5 w-3.5" /> Approve
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1.5 text-xs flex-1" onClick={() => respond.mutate({ faId: fa.id, leagueId: fa.leagueId, decision: "decline" })} disabled={respond.isPending}>
                      <ThumbsDown className="h-3.5 w-3.5" /> Decline
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </Section>
      )}

      {/* Team roster */}
      <Section title="Team Roster" icon={Users}>
        <div ref={rosterRef} className="space-y-3">
          {isLoading ? (
            [1, 2].map(i => <Skeleton key={i} className="h-20 w-full" />)
          ) : teamDashData && teamDashData.teams.length > 0 ? teamDashData.teams.map((team) => (
            <div key={team.teamId} className="bg-card rounded-xl border border-border p-5">
              {(() => {
                const playerMembers  = team.members.filter(m => ["player", "captain"].includes(m.role));
                const staffMembers   = team.members.filter(m => ["coach", "manager"].includes(m.role));
                const faCount        = team.pendingFreeAgents.length;
                const isRosterReady  = playerMembers.length >= 5;
                return (
                  <>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <ShieldCheck className="h-4 w-4 text-primary" />
                        <h4 className="font-semibold">{team.teamName}</h4>
                        {team.leagueId && (
                          <span className="text-[11px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">League</span>
                        )}
                      </div>
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${isRosterReady ? "bg-green-500/10 text-green-600 border-green-500/30" : "bg-amber-500/10 text-amber-600 border-amber-500/30"}`}>
                        {isRosterReady ? "Roster Ready" : `${playerMembers.length}/5+ players`}
                      </span>
                    </div>
                    <div className="flex gap-3 text-xs mb-3 flex-wrap">
                      <span className="text-muted-foreground"><span className="font-semibold text-green-600">{playerMembers.length}</span> confirmed</span>
                      {team.pendingCount > 0 && (
                        <span className="text-amber-500 font-medium">{team.pendingCount} pending</span>
                      )}
                      {staffMembers.length > 0 && <span className="text-muted-foreground"><span className="font-semibold text-foreground">{staffMembers.length}</span> staff</span>}
                      {faCount > 0 && <span className="text-primary font-medium">{faCount} free agent{faCount !== 1 ? "s" : ""} awaiting review</span>}
                    </div>
                    {/* Payment/balance summary */}
                    {team.registration && (() => {
                      const reg = team.registration!;
                      const balance = parseFloat(reg.balanceDue ?? "0");
                      const paid = parseFloat(reg.amountPaid ?? "0");
                      const total = parseFloat(reg.totalAmount ?? "0");
                      const depositAmt = parseFloat(reg.depositAmount ?? "0");
                      const isOverdue = reg.balanceDueDate && new Date(reg.balanceDueDate) < new Date();
                      const showDepositBtn = !reg.depositPaid && depositAmt > 0 && balance <= 0;
                      const showBalanceBtn = balance > 0;
                      return (
                        <div className="mb-2 space-y-1.5">
                          <div className={`flex items-center gap-2 text-xs rounded-lg px-3 py-2 ${
                            balance > 0 && isOverdue ? "bg-red-500/10 border border-red-500/20 text-red-600" :
                            balance > 0 ? "bg-amber-500/10 border border-amber-500/20 text-amber-600" :
                            "bg-green-500/10 border border-green-500/20 text-green-600"
                          }`}>
                            <DollarSign className="h-3.5 w-3.5 shrink-0" />
                            {balance > 0 ? (
                              <span>
                                <span className="font-semibold">${balance.toFixed(2)} balance due</span>
                                {reg.balanceDueDate && <span className="ml-1 opacity-75">(by {format(new Date(reg.balanceDueDate), "MMM d")})</span>}
                                {isOverdue && <span className="ml-1 font-bold">— OVERDUE</span>}
                                {!reg.depositPaid && reg.depositAmount && <span className="ml-1 opacity-75">· deposit ${depositAmt.toFixed(2)} unpaid</span>}
                              </span>
                            ) : (
                              <span><span className="font-semibold">Paid in full</span> <span className="opacity-75">${paid.toFixed(2)} / ${total.toFixed(2)}</span></span>
                            )}
                          </div>
                          {(showDepositBtn || showBalanceBtn) && (
                            <div className="flex gap-2">
                              {showDepositBtn && (
                                <Button size="sm" className="h-7 text-xs bg-amber-500 hover:bg-amber-600 text-black font-semibold border-none"
                                  onClick={() => startDepositPayment(reg.id, false)}>
                                  Pay Deposit — ${depositAmt.toFixed(2)}
                                </Button>
                              )}
                              {showBalanceBtn && (
                                <Button size="sm" className="h-7 text-xs bg-amber-500 hover:bg-amber-600 text-black font-semibold border-none"
                                  onClick={() => startDepositPayment(reg.id, true)}>
                                  Pay Balance — ${balance.toFixed(2)}
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    {team.members.length > 0 && (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {team.members.slice(0, 9).map((m) => (
                          <div key={m.userId} className="flex items-center gap-2 text-sm">
                            <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center text-xs font-bold shrink-0">
                              {m.jerseyNumber ?? "–"}
                            </div>
                            <span className={`text-xs capitalize ${
                              m.role === "captain" ? "text-amber-500 font-semibold" :
                              m.role === "coach" ? "text-primary font-semibold" :
                              m.role === "manager" ? "text-violet-500 font-semibold" :
                              "text-muted-foreground"
                            }`}>{m.role}</span>
                          </div>
                        ))}
                        {team.members.length > 9 && (
                          <p className="text-xs text-muted-foreground col-span-full mt-1">+{team.members.length - 9} more</p>
                        )}
                      </div>
                    )}
                    {/* Blackout / conflict date management */}
                    {team.registration && (
                      <div className="mt-4 pt-4 border-t border-border">
                        <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                          <CalendarX className="h-3.5 w-3.5" />
                          Blackout / Conflict Dates
                        </p>
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {(team.registration.blackoutDates ?? []).length === 0 ? (
                            <span className="text-xs text-muted-foreground">No conflict dates set</span>
                          ) : (team.registration.blackoutDates ?? []).map(date => (
                            <span key={date} className="inline-flex items-center gap-1 text-[11px] bg-muted px-2 py-0.5 rounded-full">
                              {format(new Date(date + "T00:00:00"), "MMM d, yyyy")}
                              <button
                                type="button"
                                className="text-muted-foreground hover:text-foreground ml-0.5"
                                aria-label={`Remove ${date}`}
                                onClick={() => {
                                  const newDates = (team.registration!.blackoutDates ?? []).filter(d => d !== date);
                                  updateBlackout.mutate({ regId: team.registration!.id, blackoutDates: newDates });
                                }}
                              >
                                <X className="h-2.5 w-2.5" />
                              </button>
                            </span>
                          ))}
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="date"
                            className="text-xs border border-border rounded-md px-2 py-1 bg-background text-foreground h-7 flex-1 min-w-0"
                            value={newDateByTeam[team.teamId] ?? ""}
                            onChange={e => setNewDateByTeam(prev => ({ ...prev, [team.teamId]: e.target.value }))}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs px-3 shrink-0"
                            disabled={!newDateByTeam[team.teamId] || updateBlackout.isPending}
                            onClick={() => {
                              const newDate = newDateByTeam[team.teamId];
                              if (!newDate || !team.registration) return;
                              const existing = team.registration.blackoutDates ?? [];
                              if (existing.includes(newDate)) return;
                              updateBlackout.mutate({
                                regId: team.registration.id,
                                blackoutDates: [...existing, newDate].sort(),
                              });
                              setNewDateByTeam(prev => ({ ...prev, [team.teamId]: "" }));
                            }}
                          >
                            Add
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          )) : (
            <div className="rounded-xl border border-dashed border-border p-10 text-center">
              <Users className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground mb-4 text-sm">Register a team in a league to start managing your roster.</p>
              <Link href="/leagues"><Button size="sm">Browse Leagues</Button></Link>
            </div>
          )}
        </div>
      </Section>

      {/* Upcoming fixtures */}
      <Section title="Upcoming Fixtures" icon={Trophy}>
        <div ref={fixturesRef} className="space-y-2">
          {isLoading ? (
            [1, 2].map(i => <Skeleton key={i} className="h-16 w-full" />)
          ) : sortedFixtures.length > 0 ? sortedFixtures.map((fixture) => (
            <div key={fixture.id} className="bg-card rounded-xl border border-border flex items-center justify-between p-4 gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-[11px] font-semibold text-muted-foreground uppercase bg-muted px-2 py-0.5 rounded-full shrink-0">{fixture.entityType}</span>
                <div>
                  <p className="font-medium text-sm">{fixture.round ? `Round ${fixture.round}` : "Fixture"} #{fixture.id}</p>
                  <p className="text-xs text-muted-foreground uppercase">{fixture.status}</p>
                </div>
              </div>
              {fixture.scheduledAt && (
                <p className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                  {formatEastern(new Date(fixture.scheduledAt), "EEE MMM d, h:mm a 'ET'")}
                </p>
              )}
            </div>
          )) : (
            <EmptyState
              icon={CalendarDays}
              title="No fixtures scheduled"
              description="Upcoming fixtures will appear here once the schedule is set."
              className="rounded-xl border border-dashed border-border"
            />
          )}
        </div>
      </Section>
    </div>

    {paymentData && (
      <InlinePaymentDialog
        open={!!paymentData}
        clientSecret={paymentData.clientSecret}
        publishableKey={paymentData.publishableKey}
        amount={paymentData.amount}
        title={paymentData.label}
        label={`${paymentData.label} — $${Number(paymentData.amount).toFixed(2)}`}
        onSuccess={() => {
          setPaymentData(null);
          queryClient.invalidateQueries({ queryKey: ["team-dashboard"] });
          toast({ title: "Payment confirmed!", description: "Your balance has been updated." });
        }}
        onCancel={() => setPaymentData(null)}
      />
    )}
    </>
  );
}


// ── Coach tab ─────────────────────────────────────────────────────────────────
function CoachTab({ staffData, isLoading }: { staffData: StaffDashboardData | undefined; isLoading: boolean }) {
  const rosterRef   = useRef<HTMLDivElement>(null);
  const fixturesRef = useRef<HTMLDivElement>(null);
  const scrollToRoster   = () => rosterRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  const scrollToFixtures = () => fixturesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  // Sort fixtures ascending by scheduledAt for nearest-first
  const sortedFixtures = [...(staffData?.upcomingFixtures ?? [])]
    .sort((a, b) => {
      if (!a.scheduledAt && !b.scheduledAt) return 0;
      if (!a.scheduledAt) return 1;
      if (!b.scheduledAt) return -1;
      return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
    });

  const nextFixture = sortedFixtures[0] ?? null;

  const heroTitle = nextFixture
    ? `${nextFixture.round ? `Round ${nextFixture.round}` : "Fixture"} #${nextFixture.id}`
    : "No upcoming fixtures";
  const heroSub = nextFixture?.scheduledAt
    ? formatEastern(new Date(nextFixture.scheduledAt), "EEE, MMM d 'at' h:mm a 'ET'")
    : "Check back when matches are scheduled.";

  return (
    <div className="space-y-6">
      {/* Hero */}
      <HeroCard
        label={nextFixture ? "Next Fixture" : "All Clear"}
        title={heroTitle}
        subtitle={heroSub}
        ctaLabel="View Fixtures"
        ctaOnClick={scrollToFixtures}
      />

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-3">
        <QuickAction icon={Users}  label="Team Roster"       onClick={scrollToRoster}   color="text-blue-500" />
        <QuickAction icon={Trophy} label="Upcoming Fixtures" onClick={scrollToFixtures} color="text-amber-500" />
      </div>

      {/* Team roster */}
      <Section title="Team Roster" icon={Users}>
        <div ref={rosterRef} className="space-y-3">
          {isLoading ? (
            [1,2].map(i => <Skeleton key={i} className="h-20 w-full" />)
          ) : staffData && staffData.teamRoster.length > 0 ? staffData.teamRoster.map((team) => (
            <div key={team.teamId} className="bg-card rounded-xl border border-border p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  <h4 className="font-semibold">{team.teamName}</h4>
                </div>
                <span className="text-[11px] font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{team.memberCount} players</span>
              </div>
              {team.members.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {team.members.slice(0, 9).map((m) => (
                    <div key={m.userId} className="flex items-center gap-2 text-sm">
                      <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center text-xs font-bold shrink-0">
                        {m.jerseyNumber ?? "–"}
                      </div>
                      <span className="text-muted-foreground capitalize text-xs">{m.role}</span>
                    </div>
                  ))}
                  {team.members.length > 9 && (
                    <p className="text-xs text-muted-foreground col-span-full mt-1">+{team.members.length - 9} more</p>
                  )}
                </div>
              )}
            </div>
          )) : (
            <EmptyState
              icon={Users}
              title="Roster not available yet"
              description="Team members will appear here once your team is registered and confirmed."
              className="rounded-xl border border-dashed border-border"
            />
          )}
        </div>
      </Section>

      {/* Upcoming fixtures */}
      <Section title="Upcoming Fixtures" icon={Trophy}>
        <div ref={fixturesRef} className="space-y-2">
          {isLoading ? (
            [1,2].map(i => <Skeleton key={i} className="h-16 w-full" />)
          ) : sortedFixtures.length > 0 ? sortedFixtures.map((fixture) => (
            <div key={fixture.id} className="bg-card rounded-xl border border-border flex items-center justify-between p-4 gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-[11px] font-semibold text-muted-foreground uppercase bg-muted px-2 py-0.5 rounded-full shrink-0">{fixture.entityType}</span>
                <div>
                  <p className="font-medium text-sm">{fixture.round ? `Round ${fixture.round}` : "Fixture"} #{fixture.id}</p>
                  <p className="text-xs text-muted-foreground uppercase">{fixture.status}</p>
                </div>
              </div>
              {fixture.scheduledAt && (
                <p className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                  {formatEastern(new Date(fixture.scheduledAt), "EEE MMM d, h:mm a 'ET'")}
                </p>
              )}
            </div>
          )) : (
            <EmptyState
              icon={CalendarDays}
              title="No fixtures scheduled"
              description="Upcoming fixtures will appear here once the schedule is set."
              className="rounded-xl border border-dashed border-border"
            />
          )}
        </div>
      </Section>
    </div>
  );
}

// ── Scorekeeper tab ────────────────────────────────────────────────────────────
function ScorekeeperTab({ staffData, isLoading, trainingStatus }: { staffData: StaffDashboardData | undefined; isLoading: boolean; trainingStatus: TrainingStatus | undefined }) {
  const fixturesRef = useRef<HTMLDivElement>(null);
  const scrollToFixtures = () => fixturesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  const sortedFixtures = [...(staffData?.upcomingFixtures ?? [])]
    .sort((a, b) => {
      if (!a.scheduledAt && !b.scheduledAt) return 0;
      if (!a.scheduledAt) return 1;
      if (!b.scheduledAt) return -1;
      return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
    });

  const nextFixture = sortedFixtures[0] ?? null;

  const heroTitle = nextFixture
    ? `${nextFixture.round ? `Round ${nextFixture.round}` : "Game"} #${nextFixture.id}`
    : "No games today";
  const heroSub = nextFixture?.scheduledAt
    ? formatEastern(new Date(nextFixture.scheduledAt), "EEE, MMM d 'at' h:mm a 'ET'")
    : "Check back when fixtures are scheduled.";

  return (
    <div className="space-y-6">
      {/* Training banner */}
      <TrainingBanner trainingStatus={trainingStatus} />

      <HeroCard
        label={nextFixture ? "Next Game" : "All Clear"}
        title={heroTitle}
        subtitle={heroSub}
        ctaLabel="View Assigned Games"
        ctaOnClick={scrollToFixtures}
      />

      <div className="grid grid-cols-2 gap-3">
        <QuickAction icon={QrCode} label="Check In Players" onClick={() => window.location.href = "/scanner"} color="text-green-500" />
        <QuickAction icon={Trophy} label="Today's Games" onClick={scrollToFixtures} color="text-amber-500" />
      </div>

      <Section title="Assigned Games" icon={Clipboard}>
        <div ref={fixturesRef} className="space-y-3">
          {isLoading ? (
            [1, 2].map(i => <Skeleton key={i} className="h-20 w-full" />)
          ) : sortedFixtures.length > 0 ? sortedFixtures.map((fixture) => (
            <div key={fixture.id} className="bg-card rounded-xl border border-border p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[11px] font-semibold text-muted-foreground uppercase bg-muted px-2 py-0.5 rounded-full shrink-0">
                    {fixture.entityType}
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">
                      {fixture.round ? `Round ${fixture.round}` : "Game"} #{fixture.id}
                    </p>
                    {fixture.scheduledAt && (
                      <p className="text-xs text-muted-foreground">
                        {formatEastern(new Date(fixture.scheduledAt), "EEE MMM d, h:mm a 'ET'")}
                      </p>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <Link href="/scanner">
                  <Button size="sm" variant="outline" className="gap-1.5 text-xs">
                    <QrCode className="h-3.5 w-3.5" /> Check In Players
                  </Button>
                </Link>
                <Link href={`/staff/game-panel/${fixture.id}`}>
                  <Button size="sm" className="gap-1.5 text-xs">
                    <Trophy className="h-3.5 w-3.5" /> Score &amp; Fouls
                  </Button>
                </Link>
              </div>
            </div>
          )) : (
            <EmptyState
              icon={CalendarDays}
              title="No upcoming fixtures"
              description="You have no fixtures assigned to you yet. New assignments will appear here."
              className="rounded-xl border border-dashed border-border"
            />
          )}
        </div>
      </Section>

      <Section title="My Earnings" icon={Wallet}>
        <div className="bg-card rounded-xl border border-border p-4 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">View your payout history and set up direct deposit.</p>
          <Link href="/staff/earnings">
            <Button size="sm" variant="outline" className="gap-1.5 text-xs shrink-0">
              <ArrowRight className="h-3.5 w-3.5" /> Earnings
            </Button>
          </Link>
        </div>
      </Section>
    </div>
  );
}

// ── Main dashboard ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: profile, isLoading: isProfileLoading } = useGetMyProfile();
  const { getToken } = useAuth();

  const { data: registrations, isLoading: isRegistrationsLoading } = useQuery<any[]>({
    queryKey: ["my-registrations"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${import.meta.env.BASE_URL}api/me/registrations`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
  const [claimingSlotId, setClaimingSlotId] = useState<number | null>(null);
  const [claimedSlotIds, setClaimedSlotIds] = useState<Set<number>>(new Set());
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimSuccessDate, setClaimSuccessDate] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DisplayRoleId | null>(null);
  const { setActiveDashTab } = useContext(DashboardTabContext);
  const [profilePromptDismissed, setProfilePromptDismissed] = useState(
    () => localStorage.getItem("profilePromptDismissed") === "1"
  );
  const [waiverModalOpen, setWaiverModalOpen] = useState(false);

  async function claimSlot(slotId: number, gameDate: string | null) {
    setClaimingSlotId(slotId);
    setClaimError(null);
    setClaimSuccessDate(null);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/sub-ref-alerts/${slotId}/claim`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setClaimError(data.error ?? "Failed to claim slot");
      } else {
        const dateLabel = gameDate ? formatEastern(new Date(gameDate), "EEE MMM d, h:mm a 'ET'") : "the game";
        setClaimSuccessDate(dateLabel);
        setClaimedSlotIds((prev) => new Set(prev).add(slotId));
        queryClient.invalidateQueries({ queryKey: ["staff-dashboard"] });
      }
    } catch {
      setClaimError("Network error — please try again");
    } finally {
      setClaimingSlotId(null);
    }
  }

  useEffect(() => {
    if (!profile) return;
    const profileRoles: string[] = Array.isArray((profile as any).roles) ? (profile as any).roles : [];
    if (profileRoles.length === 0) {
      setLocation("/onboarding");
      return;
    }
    const typedRoles = profileRoles as RoleId[];
    const dispRoles = toDisplayRoles(typedRoles);

    // Map legacy team_manager/team_coach hashes to unified my_team tab
    const rawHash = window.location.hash.replace("#", "");
    const displayHash = (rawHash === "team_manager" || rawHash === "team_coach")
      ? "my_team" as DisplayRoleId
      : rawHash as DisplayRoleId;
    const resolvedTab = dispRoles.includes(displayHash) ? displayHash : dispRoles[0];
    setActiveTab(resolvedTab);
    setActiveDashTab(resolvedTab);

    function onHashChange() {
      const newRaw = window.location.hash.replace("#", "");
      const newDisplay = (newRaw === "team_manager" || newRaw === "team_coach")
        ? "my_team" as DisplayRoleId
        : newRaw as DisplayRoleId;
      if (dispRoles.includes(newDisplay)) setActiveTab(newDisplay);
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [profile, setLocation]);

  const roles = ((profile as any)?.roles ?? []) as RoleId[];
  const isPlayer      = roles.includes("player");
  const isParent      = roles.includes("parent");
  const isRef         = roles.includes("ref");
  const isCoach       = roles.includes("coach");
  const isScorekeeper = roles.includes("scorekeeper");
  const isTeamManager = roles.includes("team_manager");
  const isTeamCoach   = roles.includes("team_coach");
  const displayRoles = toDisplayRoles(roles);

  const { data: trainingStatus } = useQuery<TrainingStatus>({
    queryKey: ["training-status"],
    enabled: !isProfileLoading && (isRef || isScorekeeper),
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${import.meta.env.BASE_URL}api/training/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return { isComplete: true };
      return res.json();
    },
    staleTime: 60_000,
  });

  const { data: reEnrollSuggestions } = useQuery<ReEnrollSuggestion[]>({
    queryKey: ["re-enrollment"],
    queryFn: async () => {
      const res = await fetch(`${import.meta.env.BASE_URL}api/registrations/re-enrollment`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: isPlayer,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const { data: staffData, isLoading: isStaffLoading } = useQuery<StaffDashboardData>({
    queryKey: ["staff-dashboard"],
    queryFn: async () => {
      const res = await fetch(`${import.meta.env.BASE_URL}api/me/staff-dashboard`, { credentials: "include" });
      if (!res.ok) return { upcomingAssignments: [], upcomingFixtures: [], teamRoster: [], openSubSlots: [] };
      return res.json();
    },
    enabled: isRef || isCoach || isScorekeeper,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const { data: teamDashData, isLoading: isTeamDashLoading } = useQuery<TeamDashboardData>({
    queryKey: ["team-dashboard"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${import.meta.env.BASE_URL}api/me/team-dashboard`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return { teams: [], upcomingFixtures: [] };
      return res.json();
    },
    enabled: !isProfileLoading && (isTeamManager || isTeamCoach || isPlayer),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const { data: freeAgentStatuses } = useQuery<FreeAgentEntry[]>({
    queryKey: ["free-agent-status"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${import.meta.env.BASE_URL}api/me/free-agent-status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: isPlayer,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const { data: healthPackets } = useQuery<HealthPacketEntry[]>({
    queryKey: ["camp-health-packets"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${import.meta.env.BASE_URL}api/me/camp-health-packets`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: isPlayer || isParent,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const { data: campRegistrations } = useQuery<any[]>({
    queryKey: ["my-camp-registrations"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${import.meta.env.BASE_URL}api/me/camp-registrations`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: isPlayer,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const { data: leagueRegistrations } = useQuery<any[]>({
    queryKey: ["my-league-registrations"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${import.meta.env.BASE_URL}api/me/league-registrations`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: isPlayer,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const { data: tournamentRegistrations } = useQuery<any[]>({
    queryKey: ["my-tournament-registrations"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${import.meta.env.BASE_URL}api/me/tournament-registrations`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: isPlayer,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const { data: dropinSpots } = useQuery<any[]>({
    queryKey: ["my-dropin-spots"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${import.meta.env.BASE_URL}api/me/dropin-spots`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: isPlayer,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const { data: pendingTeamInvites } = useQuery<TeamInviteEntry[]>({
    queryKey: ["pending-team-invites"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${import.meta.env.BASE_URL}api/me/pending-team-invites`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: isPlayer,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const { data: activeCheckInsData } = useQuery<{ checkIns: ActiveCheckIn[] }>({
    queryKey: ["my-active-checkins"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${import.meta.env.BASE_URL}api/checkin/my-active`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return { checkIns: [] };
      return res.json();
    },
    enabled: isPlayer,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const { data: familyDashboard } = useQuery<{ children: FamilyChild[] }>({
    queryKey: ["family-dashboard-summary"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${import.meta.env.BASE_URL}api/family-dashboard`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return { children: [] };
      return res.json();
    },
    enabled: !isProfileLoading && isParent,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
  const familyChildren: FamilyChild[] = familyDashboard?.children ?? [];

  const firstName = profile?.firstName || "there";

  // Captain users may not have team_manager/team_coach in their platform roles array,
  // but the team-dashboard API already queries their captain memberships. We derive
  // hasMyTeam from the API response so captains also see the My Team tab.
  const hasMyTeam = isTeamManager || isTeamCoach ||
    (!isTeamDashLoading && (teamDashData?.teams?.length ?? 0) > 0);
  const effectiveDisplayRoles: DisplayRoleId[] =
    hasMyTeam && !displayRoles.includes("my_team")
      ? [...displayRoles, "my_team"]
      : displayRoles;
  const multiRole = effectiveDisplayRoles.length > 1;

  if (isProfileLoading || (profile && !activeTab && roles.length > 0)) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-12 space-y-6">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-32 w-full" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">{[1,2,3,4].map(i => <Skeleton key={i} className="h-20" />)}</div>
          <Skeleton className="h-64 w-full" />
        </div>
      </Layout>
    );
  }

  const currentTab = activeTab ?? effectiveDisplayRoles[0] ?? "player";

  function handleTabChange(value: string) {
    const id = value as DisplayRoleId;
    setActiveTab(id);
    setActiveDashTab(id);
    window.history.replaceState(null, "", `#${id}`);
  }

  const tabContent: Partial<Record<DisplayRoleId, React.ReactNode>> = {};
  if (isPlayer)   tabContent.player       = <PlayerTab registrations={registrations as any} campRegistrations={campRegistrations} leagueRegistrations={leagueRegistrations} tournamentRegistrations={tournamentRegistrations} dropinSpots={dropinSpots} reEnrollSuggestions={reEnrollSuggestions} isLoading={isProfileLoading || isRegistrationsLoading} freeAgentStatuses={freeAgentStatuses ?? []} healthPackets={(healthPackets ?? []).filter(e => !e.isChild)} teamInvites={pendingTeamInvites ?? []} activeCheckIns={activeCheckInsData?.checkIns ?? []} familyChildren={familyChildren} getToken={getToken} />;
  if (isParent)   tabContent.parent       = <ParentTab />;
  if (isRef)      tabContent.ref          = <RefTab staffData={staffData} isLoading={isStaffLoading} claimingSlotId={claimingSlotId} claimedSlotIds={claimedSlotIds} claimError={claimError} claimSuccessDate={claimSuccessDate} onClaim={claimSlot} trainingStatus={trainingStatus} />;
  if (isCoach)    tabContent.coach        = <CoachTab staffData={staffData} isLoading={isStaffLoading} />;
  if (isScorekeeper) tabContent.scorekeeper = <ScorekeeperTab staffData={staffData} isLoading={isStaffLoading} trainingStatus={trainingStatus} />;
  if (hasMyTeam)  tabContent.my_team      = <MyTeamTab teamDashData={teamDashData} isLoading={isTeamDashLoading} isTeamManager={isTeamManager || (!isTeamCoach && hasMyTeam)} />;

  const missingPhone = !(profile as any)?.phone;
  const missingDob = !(profile as any)?.dateOfBirth;
  const showProfilePrompt = (missingPhone || missingDob) && !profilePromptDismissed;

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        {/* Page header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold tracking-tight">
            Welcome back, {firstName}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {[...new Set(roles.map(r => ROLE_META[r]?.label).filter(Boolean))].join(" · ")}
          </p>
        </div>

        {/* Complete your profile prompt (non-blocking, optional fields only) */}
        {showProfilePrompt && (
          <div className="mb-6 rounded-xl bg-muted border border-border px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
                Complete your profile
              </p>
              <p className="text-muted-foreground text-xs leading-relaxed">
                {[
                  missingPhone && "Add your phone number",
                  missingDob && "Add your date of birth",
                ]
                  .filter(Boolean)
                  .join(" · ")}{" "}
                to get the most out of PlayOn.
              </p>
            </div>
            <div className="flex items-center gap-3 flex-wrap shrink-0">
              <Link href="/profile">
                <Button size="sm" variant="outline" className="gap-1.5 text-xs h-8">
                  <Phone className="h-3 w-3" />
                  Update profile
                </Button>
              </Link>
              <button
                type="button"
                onClick={() => {
                  setProfilePromptDismissed(true);
                  localStorage.setItem("profilePromptDismissed", "1");
                }}
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Dismiss"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* Single-role: no tabs */}
        {!multiRole ? (
          <div>{tabContent[currentTab]}</div>
        ) : (
          <Tabs value={currentTab} onValueChange={handleTabChange}>
            <TabsList className="w-full justify-start overflow-x-auto h-auto p-0 bg-transparent border-b border-border rounded-none gap-0 flex-nowrap mb-6">
              {effectiveDisplayRoles.map((role) => {
                const meta = DISPLAY_ROLE_META[role];
                if (!meta) return null;
                return (
                  <TabsTrigger
                    key={role}
                    value={role}
                    className="flex items-center gap-2 px-4 py-3 text-sm rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-muted-foreground whitespace-nowrap flex-shrink-0"
                  >
                    <span>{meta.emoji}</span>
                    {meta.label}
                  </TabsTrigger>
                );
              })}
            </TabsList>
            {effectiveDisplayRoles.map((role) => (
              <TabsContent key={role} value={role}>
                {tabContent[role]}
              </TabsContent>
            ))}
          </Tabs>
        )}
      </div>
      <WaiverModal
        open={waiverModalOpen}
        onOpenChange={setWaiverModalOpen}
        onComplete={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/me"] });
          queryClient.invalidateQueries({ queryKey: ["me", "participant-profile"] });
        }}
      />
    </Layout>
  );
}
