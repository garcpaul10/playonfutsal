import { API_BASE } from "@/lib/api-base";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { useAuth, useUser, Show } from "@clerk/react";
import { useGetMyRegistrations, useGetMyProfile } from "@workspace/api-client-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import {
  CalendarDays, Users, Crown, Gift, RefreshCw, Bot, ChevronRight, Send,
  CheckCircle2, Clock, CalendarX, Plus, Trophy, Baby, ArrowRight,
  Loader2, Copy, Link2, ThumbsUp, ThumbsDown, MessageSquare, Trash2, X, AlertCircle,
} from "lucide-react";
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
import { format } from "date-fns";
import { formatEastern } from "@/lib/timezone";


type Tab = "activity" | "family" | "memberships" | "referrals" | "assistant";

// ── Registration status helpers ───────────────────────────────────────────────
function statusBorderClass(status: string) {
  switch (status) {
    case "confirmed":       return "border-l-4 border-l-green-500";
    case "pending":         return "border-l-4 border-l-amber-400";
    case "pending_payment": return "border-l-4 border-l-amber-400";
    case "waitlisted":      return "border-l-4 border-l-gray-400";
    case "cancelled":       return "border-l-4 border-l-red-500";
    case "expired":         return "border-l-4 border-l-red-400";
    default:                return "border-l-4 border-l-border";
  }
}
function statusBadge(status: string) {
  switch (status) {
    case "confirmed":       return "bg-green-500/15 text-green-600 border-green-500/30";
    case "pending":         return "bg-amber-400/15 text-amber-600 border-amber-400/30";
    case "pending_payment": return "bg-amber-400/15 text-amber-600 border-amber-400/30";
    case "waitlisted":      return "bg-gray-400/15 text-gray-500 border-gray-400/30";
    case "cancelled":       return "bg-red-500/15 text-red-500 border-red-500/30";
    case "expired":         return "bg-red-400/15 text-red-500 border-red-400/30";
    default:                return "";
  }
}
function statusLabel(status: string) {
  switch (status) {
    case "pending_payment": return "Awaiting payment";
    case "expired":         return "Registration expired";
    default:                return status;
  }
}

// ── Activity Tab ──────────────────────────────────────────────────────────────
function ActivityTab() {
  const { getToken } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [cancelSpot, setCancelSpot] = useState<{ id: number; name: string; startsAt: string } | null>(null);
  const { data: registrations, isLoading: regLoading } = useGetMyRegistrations();
  const { data: profile } = useGetMyProfile();

  const cancelMutation = useMutation({
    mutationFn: async (spotId: number) => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/dropins/spots/${spotId}`, {
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

  const { data: reEnrollSuggestions } = useQuery<any[]>({
    queryKey: ["re-enrollment"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/registrations/re-enrollment`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: freeAgentStatuses } = useQuery<any[]>({
    queryKey: ["free-agent-status"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/leagues/free-agent-status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: dropinSpots } = useQuery<any[]>({
    queryKey: ["my-dropin-spots"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/me/dropin-spots`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 60_000,
  });

  const allRegs = registrations ?? [];
  const active = allRegs.filter((r: any) => r.status !== "cancelled");
  const upcoming = active.slice(0, 10);
  const upcomingDropins = (dropinSpots ?? []).slice(0, 10);
  const hasActivity = upcoming.length > 0 || upcomingDropins.length > 0;

  return (
    <div className="space-y-6">
      {/* Quick actions */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Explore programs", href: "/",             icon: Trophy,      color: "text-primary" },
          { label: "Registrations",      href: "/me?tab=activity", icon: CalendarDays, color: "text-blue-500" },
          { label: "Re-enroll",         href: "/me?tab=activity",   icon: RefreshCw,   color: "text-amber-500" },
          { label: "QR Code",           href: "/account?tab=qr", icon: CheckCircle2, color: "text-green-500" },
        ].map((a) => (
          <Link key={a.href} href={a.href}>
            <div className="group flex flex-col items-center gap-2 p-4 rounded-xl bg-card border border-border hover:border-primary/40 hover:bg-primary/5 transition-all cursor-pointer text-center">
              <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center group-hover:bg-primary/10 transition-colors">
                <a.icon className={`h-5 w-5 ${a.color}`} />
              </div>
              <span className="text-xs font-medium text-foreground leading-tight">{a.label}</span>
            </div>
          </Link>
        ))}
      </div>

      {/* Drop-in spots */}
      {upcomingDropins.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <CalendarDays className="h-4 w-4" /> My Drop-in Sessions
          </h3>
          <div className="space-y-2">
            {upcomingDropins.map((spot: any) => (
              <div key={`dropin-${spot.id}`} className={`bg-card rounded-xl border border-border p-4 ${statusBorderClass(spot.waitlisted ? "waitlisted" : "confirmed")}`}>
                <div className="flex items-start justify-between gap-3">
                  <Link href={`/dropins/${spot.dropinId}`} className="min-w-0 flex-1">
                    <p className="font-semibold text-sm truncate">{spot.dropinName || `Drop-in #${spot.dropinId}`}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 capitalize">
                      drop-in · {format(new Date(spot.startsAt), "EEE, MMM d")} · {formatEastern(new Date(spot.startsAt), "h:mm a 'ET'")}{spot.endsAt ? ` – ${formatEastern(new Date(spot.endsAt), "h:mm a 'ET'")}` : ""}
                    </p>
                  </Link>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className={`text-[10px] capitalize ${statusBadge(spot.waitlisted ? "waitlisted" : "confirmed")}`}>
                      {spot.waitlisted ? "waitlisted" : "confirmed"}
                    </Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive h-7 w-7 p-0"
                      title="Cancel spot"
                      onClick={() => setCancelSpot({ id: spot.id, name: spot.dropinName || `Drop-in #${spot.dropinId}`, startsAt: spot.startsAt })}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
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

      {/* Registrations */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
          <CalendarDays className="h-4 w-4" /> My Registrations
        </h3>
        {regLoading ? (
          <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
        ) : !hasActivity ? (
          <Card>
            <CardContent className="py-8 text-center">
              <CalendarX className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="font-semibold text-foreground">No registrations yet</p>
              <p className="text-sm text-muted-foreground mt-1 mb-4">Browse programs and sign up to get started</p>
              <Button asChild size="sm"><Link href="/">Explore programs</Link></Button>
            </CardContent>
          </Card>
        ) : upcoming.length === 0 ? null : (
          <div className="space-y-2">
            {upcoming.map((reg: any) => (
              <div key={reg.id} className={`bg-card rounded-xl border border-border p-4 ${statusBorderClass(reg.status)}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate">{reg.programName || `Registration #${reg.id}`}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 capitalize">{reg.programType?.replace("_", " ")} · registered {format(new Date(reg.createdAt), "MMM d, yyyy")}</p>
                  </div>
                  <Badge variant="outline" className={`text-[10px] capitalize shrink-0 ${statusBadge(reg.status)}`}>{statusLabel(reg.status)}</Badge>
                </div>
              </div>
            ))}
            {allRegs.length > 10 && (
              <Button variant="outline" size="sm" className="w-full" asChild>
                <Link href="/dashboard">View all registrations <ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Link>
              </Button>
            )}
          </div>
        )}
      </section>

      {/* Free agent status */}
      {freeAgentStatuses && freeAgentStatuses.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <Users className="h-4 w-4" /> Free Agent Status
          </h3>
          <div className="space-y-2">
            {freeAgentStatuses.map((fa: any) => (
              <div key={fa.id} className="bg-card rounded-xl border border-border p-4">
                <p className="font-semibold text-sm">{fa.leagueName}</p>
                <p className="text-xs text-muted-foreground mt-0.5 capitalize">{fa.matchStatus?.replace("_", " ")}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Re-enroll suggestions */}
      {reEnrollSuggestions && reEnrollSuggestions.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <RefreshCw className="h-4 w-4" /> Re-enroll
          </h3>
          <div className="space-y-2">
            {reEnrollSuggestions.slice(0, 3).map((s: any) => (
              <div key={s.previousRegistrationId} className="bg-card rounded-xl border border-primary/20 border-l-4 border-l-primary p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-sm">{s.programName}</p>
                  <p className="text-xs text-muted-foreground capitalize">{s.programType?.replace("_", " ")}</p>
                </div>
                <Button size="sm" asChild>
                  <Link href={(() => {
                    const typeToPath: Record<string, string> = {
                      league: "leagues", camp: "camps", tournament: "tournaments", drop_in: "dropins",
                    };
                    const seg = typeToPath[s.programType] || "leagues";
                    return `/${seg}/${s.programId}`;
                  })()}>
                    Re-enroll
                  </Link>
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ── Family Tab ────────────────────────────────────────────────────────────────
function FamilyTab() {
  const { getToken } = useAuth();
  const { data: links, isLoading } = useQuery<any[]>({
    queryKey: ["guardian-links-me"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/me/guardian-links`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return [];
      return res.json();
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Manage youth players linked to your account.</p>
        <Button size="sm" variant="outline" asChild>
          <Link href="/family/dashboard"><Users className="mr-1.5 h-3.5 w-3.5" /> Full family dashboard</Link>
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      ) : !links || links.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <Baby className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="font-semibold">No family members linked</p>
            <p className="text-sm text-muted-foreground mt-1 mb-4">Add youth players to manage their registrations</p>
            <Button asChild size="sm"><Link href="/family/dashboard">Go to Family Dashboard</Link></Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {links.map((child: any) => (
            <Link key={child.youthUserId} href={`/guardian/children/${child.youthUserId}`}>
              <div className="bg-card rounded-xl border border-border p-4 flex items-center justify-between gap-3 hover:border-primary/40 transition-colors cursor-pointer">
                <div className="flex items-center gap-3">
                  <Avatar className="h-10 w-10">
                    <AvatarFallback className="text-sm">{child.youthFirstName?.[0]}{child.youthLastName?.[0]}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-semibold text-sm">{child.youthFirstName} {child.youthLastName}</p>
                    <p className="text-xs text-muted-foreground capitalize">{child.relationship} · {child.registrations ?? 0} registration{child.registrations !== 1 ? "s" : ""}</p>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </Link>
          ))}
          <Button variant="outline" size="sm" className="w-full" asChild>
            <Link href="/me?tab=family"><Plus className="mr-1.5 h-3.5 w-3.5" /> Add family member</Link>
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Memberships Tab ───────────────────────────────────────────────────────────
function MembershipsTab() {
  const { data: plans = [], isLoading: plansLoading } = useQuery<any[]>({
    queryKey: ["membership-plans"],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/membership-plans`);
      if (!r.ok) return [];
      return r.json();
    },
  });

  const { data: myMembership } = useQuery({
    queryKey: ["memberships", "my"],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/memberships/my`, { credentials: "include" });
      if (!r.ok) return null;
      return r.json();
    },
  });

  return (
    <div className="space-y-4">
      {myMembership && (
        <div className="flex items-center gap-3 bg-primary/5 border border-primary/20 rounded-xl p-4">
          <Crown className="h-5 w-5 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm">{myMembership.planName}</p>
            <p className="text-xs text-muted-foreground capitalize">{myMembership.status}</p>
          </div>
          <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/30 text-[10px]">Active</Badge>
        </div>
      )}

      <p className="text-sm text-muted-foreground">Choose a membership plan for discounts and benefits.</p>

      {plansLoading ? (
        <div className="space-y-3">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}</div>
      ) : plans.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">No membership plans available.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {plans.map((plan: any) => (
            <Card key={plan.id} className={myMembership?.planId === plan.id ? "border-primary/40" : ""}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <CardTitle className="text-base">{plan.name}</CardTitle>
                  <div className="text-right">
                    <span className="text-xl font-black text-foreground">${(plan.price / 100).toFixed(2)}</span>
                    <span className="text-xs text-muted-foreground">/{plan.interval ?? "mo"}</span>
                  </div>
                </div>
                {plan.description && <CardDescription className="text-sm">{plan.description}</CardDescription>}
              </CardHeader>
              <CardContent className="pt-0">
                {myMembership?.planId === plan.id ? (
                  <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">Current plan</Badge>
                ) : (
                  <Button size="sm" asChild variant="outline" className="w-full">
                    <Link href="/memberships">View plan details</Link>
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Referrals Tab ─────────────────────────────────────────────────────────────
function ReferralsTab() {
  const { getToken } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<any>({
    queryKey: ["referrals-my-me"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/referrals/my`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      return res.json();
    },
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/referrals/generate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to generate code");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["referrals-my-me"] }),
    onError: () => toast({ title: "Error", description: "Could not generate referral link.", variant: "destructive" }),
  });

  const link = data?.link ?? null;

  const copyLink = async () => {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    toast({ title: "Link copied!" });
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Share PlayOn and earn credit when friends sign up.</p>

      {isLoading ? (
        <Skeleton className="h-32 rounded-xl" />
      ) : !data ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">Referral info unavailable.</CardContent></Card>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Total referred", value: data.referrals?.length ?? 0 },
              { label: "Pending", value: data.pendingCount ?? 0 },
              { label: "Credits earned", value: `$${(((data.completedCount ?? 0) * (data.rewardCreditCents ?? 0)) / 100).toFixed(2)}` },
            ].map((s) => (
              <Card key={s.label}>
                <CardContent className="py-4 text-center">
                  <p className="text-2xl font-black text-foreground">{s.value}</p>
                  <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {link ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2"><Link2 className="h-4 w-4" /> Your referral link</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 pt-0">
                <div className="bg-muted rounded-lg px-3 py-2 text-xs text-muted-foreground font-mono break-all">{link}</div>
                <Button onClick={copyLink} size="sm" variant="outline" className="w-full gap-1.5">
                  <Copy className="h-3.5 w-3.5" /> Copy link
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-6 text-center space-y-3">
                <p className="text-sm text-muted-foreground">You don't have a referral link yet.</p>
                <Button
                  onClick={() => generateMutation.mutate()}
                  disabled={generateMutation.isPending}
                  size="sm"
                  className="gap-1.5"
                >
                  <Link2 className="h-3.5 w-3.5" />
                  {generateMutation.isPending ? "Generating…" : "Generate My Link"}
                </Button>
              </CardContent>
            </Card>
          )}

          {data.referrals?.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Referred players</h3>
              <div className="space-y-2">
                {data.referrals.map((r: any) => (
                  <div key={r.id} className="bg-card rounded-xl border border-border p-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-sm">{r.referredName || r.referredEmail}</p>
                      <p className="text-xs text-muted-foreground">{format(new Date(r.createdAt), "MMM d, yyyy")}</p>
                    </div>
                    <Badge variant="outline" className={`text-[10px] capitalize ${r.status === "completed" ? "bg-green-500/10 text-green-600 border-green-500/30" : ""}`}>
                      {r.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

// ── AI Assistant Tab ──────────────────────────────────────────────────────────
interface ChatMsg { role: "user" | "assistant"; content: string; createdAt: string; }
interface Convo { id: number; title: string; isActive: boolean; lastMessageAt: string | null; createdAt: string; messages: ChatMsg[]; }

function AssistantTab() {
  const { getToken } = useAuth();
  const { toast } = useToast();
  const [conversations, setConversations] = useState<Convo[]>([]);
  const [activeConvoId, setActiveConvoId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingConvos, setLoadingConvos] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const authFetch = useCallback(async (url: string, opts: RequestInit = {}) => {
    const token = await getToken();
    return fetch(url, { ...opts, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(opts.headers ?? {}) } });
  }, [getToken]);

  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch(`${API_BASE}/assistant/conversations`);
        if (res.ok) {
          const data: Convo[] = await res.json();
          setConversations(data);
          const active = data.find((c) => c.isActive) ?? data[0] ?? null;
          if (active) { setActiveConvoId(active.id); setMessages(active.messages ?? []); }
        }
      } finally { setLoadingConvos(false); }
    })();
  }, []);

  useEffect(() => {
    setTimeout(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, 50);
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || sending) return;
    const text = input.trim();
    setInput("");
    setSending(true);
    const userMsg: ChatMsg = { role: "user", content: text, createdAt: new Date().toISOString() };
    setMessages((m) => [...m, userMsg]);

    try {
      let convoId = activeConvoId;
      if (!convoId) {
        const res = await authFetch(`${API_BASE}/assistant/conversations`, { method: "POST", body: JSON.stringify({ title: text.slice(0, 50) }) });
        if (!res.ok) throw new Error();
        const created: Convo = await res.json();
        convoId = created.id;
        setActiveConvoId(convoId);
        setConversations((c) => [created, ...c]);
      }
      const res = await authFetch(`${API_BASE}/assistant/conversations/${convoId}/messages`, { method: "POST", body: JSON.stringify({ content: text }) });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setMessages((m) => [...m, { role: "assistant", content: data.content, createdAt: new Date().toISOString() }]);
    } catch {
      toast({ title: "Failed to send message", variant: "destructive" });
      setMessages((m) => m.filter((x) => x !== userMsg));
      setInput(text);
    } finally { setSending(false); }
  };

  const newChat = async () => {
    const res = await authFetch(`${API_BASE}/assistant/conversations`, { method: "POST", body: JSON.stringify({ title: "New conversation" }) });
    if (res.ok) { const c: Convo = await res.json(); setConversations((cs) => [c, ...cs]); setActiveConvoId(c.id); setMessages([]); }
  };

  return (
    <div className="flex flex-col h-[600px]">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-muted-foreground flex items-center gap-1.5"><Bot className="h-4 w-4" /> Ask anything about PlayOn programs, rules, or your registrations.</p>
        <Button size="sm" variant="outline" onClick={newChat} className="gap-1.5"><Plus className="h-3.5 w-3.5" /> New chat</Button>
      </div>

      <div className="flex gap-3 flex-1 min-h-0">
        {/* Sidebar: past conversations */}
        <div className="hidden sm:flex w-44 flex-col gap-1 flex-shrink-0">
          {loadingConvos ? (
            <div className="space-y-1">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-9 rounded-lg" />)}</div>
          ) : conversations.map((c) => (
            <button
              key={c.id}
              onClick={async () => {
                setActiveConvoId(c.id);
                const res = await authFetch(`${API_BASE}/assistant/conversations/${c.id}`);
                if (res.ok) { const data: Convo = await res.json(); setMessages(data.messages ?? []); }
              }}
              className={`text-left text-xs px-3 py-2.5 rounded-lg transition-colors truncate ${c.id === activeConvoId ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            >
              {c.title || "Chat"}
            </button>
          ))}
        </div>

        {/* Chat area */}
        <div className="flex flex-col flex-1 min-h-0 border border-border rounded-xl overflow-hidden">
          <ScrollArea className="flex-1 p-4" ref={scrollRef as any}>
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center py-12 gap-3">
                <Bot className="h-10 w-10 text-muted-foreground" />
                <p className="font-semibold">Hi! I'm the PlayOn assistant.</p>
                <p className="text-sm text-muted-foreground max-w-xs">Ask me about leagues, camps, drop-ins, tournaments, or your registrations.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((msg, i) => (
                  <div key={i} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                    <div className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold ${msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                      {msg.role === "user" ? "You" : <Bot className="h-4 w-4" />}
                    </div>
                    <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${msg.role === "user" ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-muted text-foreground rounded-tl-sm"}`}>
                      {msg.content}
                    </div>
                  </div>
                ))}
                {sending && (
                  <div className="flex gap-3">
                    <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center">
                      <Bot className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1">
                      {[0,1,2].map((i) => <div key={i} className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />)}
                    </div>
                  </div>
                )}
              </div>
            )}
          </ScrollArea>
          <div className="border-t border-border p-3 flex gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask something…"
              className="resize-none min-h-[44px] max-h-[120px] text-sm"
              rows={1}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            />
            <Button size="icon" onClick={sendMessage} disabled={!input.trim() || sending} className="h-[44px] w-[44px] shrink-0">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main My PlayOn page ───────────────────────────────────────────────────────
export default function MyPlayOnPage() {
  const [location] = useLocation();
  const params = new URLSearchParams(window.location.search);
  const initialTab = (params.get("tab") as Tab) ?? "activity";
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const t = p.get("tab") as Tab;
    if (t) setActiveTab(t);
  }, [location]);

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "activity",    label: "My Activity",  icon: CalendarDays },
    { id: "family",      label: "Family",        icon: Users },
    { id: "memberships", label: "Memberships",   icon: Crown },
    { id: "referrals",   label: "Referrals",     icon: Gift },
    { id: "assistant",   label: "AI Assistant",  icon: Bot },
  ];

  return (
    <Layout>
      <Show when="signed-out">
        <div className="container mx-auto px-4 py-24 max-w-md text-center">
          <CalendarDays className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-3">Sign in to view your Dashboard</h1>
          <Button asChild><Link href="/sign-in">Sign In</Link></Button>
        </div>
      </Show>
      <Show when="signed-in">
        <div className="container mx-auto px-4 py-8 max-w-3xl">
          <h1 className="text-3xl font-bold uppercase tracking-tight mb-6">Dashboard</h1>

          {/* Tab bar */}
          <div className="flex gap-0 border-b border-border mb-8 overflow-x-auto scrollbar-hide">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex-shrink-0 ${
                  activeTab === tab.id
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === "activity"    && <ActivityTab />}
          {activeTab === "family"      && <FamilyTab />}
          {activeTab === "memberships" && <MembershipsTab />}
          {activeTab === "referrals"   && <ReferralsTab />}
          {activeTab === "assistant"   && <AssistantTab />}
        </div>
      </Show>
    </Layout>
  );
}
