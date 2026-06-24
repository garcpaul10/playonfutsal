import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/react";
import { AdminLayout } from "@/components/admin-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import {
  MessageSquare, Users, Send, Loader2, Sparkles, ChevronDown,
  Mail, Bell, RefreshCw, Clock, X, CheckSquare, Square,
} from "lucide-react";
import { format } from "date-fns";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

interface Recipient {
  id: number;
  name: string;
  email: string;
  status: string;
}

interface EventOption {
  id: number;
  name: string;
  type: string;
}

interface PoolOption {
  id: number;
  name: string;
}

interface HistoryRow {
  id: number;
  createdAt: string;
  subject: string;
  body: string;
  channels: string[];
  offeringType: string | null;
  eventId: number | null;
  poolId: number | null;
  statusFilter: string | null;
  recipientCount: number;
  senderFirstName: string | null;
  senderLastName: string | null;
  senderEmail: string;
}

const OFFERING_LABELS: Record<string, string> = {
  all: "All offering types",
  league: "Leagues",
  tournament: "Tournaments",
  camp: "Camps",
  drop_in: "Drop-in Sessions",
};

const STATUS_LABELS: Record<string, string> = {
  both: "Registered & Waitlisted",
  registered: "Registered only",
  waitlisted: "Waitlisted only",
};

export default function AdminMessaging() {
  const { getToken } = useAuth();
  const { toast } = useToast();

  // Filter state
  const [offeringType, setOfferingType] = useState("all");
  const [eventId, setEventId] = useState<string>("");
  const [eventType, setEventType] = useState<string>("");
  const [poolId, setPoolId] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState("both");

  // Data
  const [events, setEvents] = useState<EventOption[]>([]);
  const [pools, setPools] = useState<PoolOption[]>([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [excludedIds, setExcludedIds] = useState<Set<number>>(new Set());
  const [loadingRecipients, setLoadingRecipients] = useState(false);

  // Compose
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [channels, setChannels] = useState<string[]>(["in_app"]);
  const [sending, setSending] = useState(false);
  const [drafting, setDrafting] = useState(false);

  // History
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Load events when offeringType changes
  useEffect(() => {
    setEventId("");
    setEventType("");
    setPoolId("");
    setRecipients([]);
    setExcludedIds(new Set());
    loadEvents();
  }, [offeringType]);

  // Load pools when eventId changes (drop-in only)
  useEffect(() => {
    setPoolId("");
    if (offeringType === "drop_in" && eventId) {
      loadPools(parseInt(eventId));
    } else {
      setPools([]);
    }
  }, [eventId, offeringType]);

  async function authHeaders() {
    const token = await getToken();
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  }

  async function loadEvents() {
    try {
      const headers = await authHeaders();
      const params = offeringType !== "all" ? `?offeringType=${offeringType}` : "";
      const res = await fetch(`${API_BASE}/messaging/events${params}`, { headers });
      if (res.ok) setEvents(await res.json());
    } catch {
      // non-blocking
    }
  }

  async function loadPools(dropinId: number) {
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_BASE}/messaging/pools?dropinId=${dropinId}`, { headers });
      if (res.ok) setPools(await res.json());
    } catch {
      // non-blocking
    }
  }

  const fetchRecipients = useCallback(async () => {
    setLoadingRecipients(true);
    setExcludedIds(new Set());
    try {
      const headers = await authHeaders();
      const params = new URLSearchParams();
      if (offeringType && offeringType !== "all") params.set("offeringType", offeringType);
      if (eventId) params.set("eventId", eventId);
      if (eventType) params.set("eventType", eventType);
      if (poolId) params.set("poolId", poolId);
      params.set("status", statusFilter);
      const res = await fetch(`${API_BASE}/messaging/recipients?${params}`, { headers });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setRecipients(data.recipients ?? []);
    } catch {
      toast({ title: "Failed to load recipients", variant: "destructive" });
    } finally {
      setLoadingRecipients(false);
    }
  }, [offeringType, eventId, eventType, poolId, statusFilter]);

  async function loadHistory() {
    setHistoryLoading(true);
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_BASE}/messaging/history`, { headers });
      if (res.ok) setHistory(await res.json());
    } catch {
      // non-blocking
    } finally {
      setHistoryLoading(false);
    }
  }

  function toggleChannel(ch: string) {
    setChannels((prev) =>
      prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch],
    );
  }

  function toggleExclude(id: number) {
    setExcludedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (excludedIds.size === 0) {
      setExcludedIds(new Set(recipients.map((r) => r.id)));
    } else {
      setExcludedIds(new Set());
    }
  }

  const activeRecipients = recipients.filter((r) => !excludedIds.has(r.id));

  async function handleDraftWithAI() {
    if (!subject.trim()) {
      toast({ title: "Enter a subject first — it's used as the AI prompt topic", variant: "destructive" });
      return;
    }
    setDrafting(true);
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_BASE}/assistant/draft-announcement`, {
        method: "POST",
        headers,
        body: JSON.stringify({ topic: subject.trim() }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setBody(data.draft ?? "");
      toast({ title: "AI draft ready", description: "Review and edit before sending." });
    } catch {
      toast({ title: "AI draft failed", variant: "destructive" });
    } finally {
      setDrafting(false);
    }
  }

  async function handleSend() {
    if (!subject.trim() || !body.trim()) {
      toast({ title: "Subject and message body are required", variant: "destructive" });
      return;
    }
    if (channels.length === 0) {
      toast({ title: "Select at least one channel", variant: "destructive" });
      return;
    }
    if (activeRecipients.length === 0) {
      toast({ title: "No recipients selected", variant: "destructive" });
      return;
    }

    setSending(true);
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_BASE}/messaging/send`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          subject: subject.trim(),
          body: body.trim(),
          channels,
          offeringType: offeringType !== "all" ? offeringType : undefined,
          eventId: eventId ? parseInt(eventId) : undefined,
          eventType: eventType || undefined,
          poolId: poolId ? parseInt(poolId) : undefined,
          statusFilter,
          individualIds: activeRecipients.map((r) => r.id),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: data.error ?? "Failed to send", variant: "destructive" });
        return;
      }
      const failedNote = data.failed > 0 ? ` (${data.failed} failed)` : "";
      toast({
        title: "Message sent",
        description: `Delivered to ${data.sent} of ${data.total} recipient${data.total !== 1 ? "s" : ""}${failedNote}.`,
      });
      // Reset compose
      setSubject("");
      setBody("");
      setChannels(["in_app"]);
      setRecipients([]);
      setExcludedIds(new Set());
      setEventId("");
      setEventType("");
      setPoolId("");
      setOfferingType("all");
      setStatusFilter("both");
    } catch {
      toast({ title: "Failed to send message", variant: "destructive" });
    } finally {
      setSending(false);
    }
  }

  return (
    <AdminLayout>
      <div className="p-6 space-y-6 max-w-5xl">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MessageSquare className="h-6 w-6 text-primary" />
            <div>
              <h1 className="text-xl font-bold">Broadcast Messaging</h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Send announcements to players filtered by event, pool, or status
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => {
              setShowHistory((v) => !v);
              if (!showHistory) loadHistory();
            }}
          >
            <Clock className="h-3.5 w-3.5" />
            {showHistory ? "Compose" : "History"}
          </Button>
        </div>

        {showHistory ? (
          /* ── Sent history ─────────────────────────────────────────────── */
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                Sent Messages
              </CardTitle>
            </CardHeader>
            <CardContent>
              {historyLoading ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : history.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-10">No messages sent yet.</p>
              ) : (
                <div className="space-y-3">
                  {history.map((h) => (
                    <div key={h.id} className="rounded-lg border p-4 space-y-1.5">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-semibold text-foreground leading-snug">{h.subject}</p>
                        <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
                          {format(new Date(h.createdAt), "MMM d, h:mm a")}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">{h.body}</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="secondary" className="text-[10px]">
                          {h.recipientCount} recipient{h.recipientCount !== 1 ? "s" : ""}
                        </Badge>
                        {h.channels.map((c) => (
                          <Badge key={c} variant="outline" className="text-[10px]">
                            {c === "in_app" ? "In-app" : "Email"}
                          </Badge>
                        ))}
                        {h.offeringType && (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground">
                            {OFFERING_LABELS[h.offeringType] ?? h.offeringType}
                          </Badge>
                        )}
                        <span className="text-[10px] text-muted-foreground">
                          by {h.senderFirstName ?? h.senderEmail}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          /* ── Compose ──────────────────────────────────────────────────── */
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* Left: Filters + Recipients */}
            <div className="space-y-4">

              {/* Audience filter panel */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    Audience
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">

                  {/* Offering type */}
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Offering type</Label>
                    <select
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                      value={offeringType}
                      onChange={(e) => setOfferingType(e.target.value)}
                    >
                      {Object.entries(OFFERING_LABELS).map(([v, label]) => (
                        <option key={v} value={v}>{label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Event picker */}
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">
                      Event <span className="text-muted-foreground/50">(optional)</span>
                    </Label>
                    <select
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                      value={eventId}
                      onChange={(e) => {
                        const id = e.target.value;
                        setEventId(id);
                        const found = events.find((ev) => String(ev.id) === id);
                        setEventType(found?.type ?? "");
                      }}
                    >
                      <option value="">All events</option>
                      {events.map((e) => (
                        <option key={`${e.type}-${e.id}`} value={String(e.id)}>
                          {e.name}
                          {offeringType === "all" ? ` (${OFFERING_LABELS[e.type] ?? e.type})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Pool picker — drop-ins only */}
                  {offeringType === "drop_in" && pools.length > 0 && (
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1.5 block">
                        Pool <span className="text-muted-foreground/50">(optional)</span>
                      </Label>
                      <select
                        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                        value={poolId}
                        onChange={(e) => setPoolId(e.target.value)}
                      >
                        <option value="">All pools</option>
                        {pools.map((p) => (
                          <option key={p.id} value={String(p.id)}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Status filter */}
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Registration status</Label>
                    <select
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                    >
                      {Object.entries(STATUS_LABELS).map(([v, label]) => (
                        <option key={v} value={v}>{label}</option>
                      ))}
                    </select>
                  </div>

                  <Button
                    onClick={fetchRecipients}
                    disabled={loadingRecipients}
                    className="w-full gap-2"
                    variant="secondary"
                  >
                    {loadingRecipients
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <RefreshCw className="h-4 w-4" />
                    }
                    {loadingRecipients ? "Loading…" : "Preview recipients"}
                  </Button>
                </CardContent>
              </Card>

              {/* Recipient list */}
              {recipients.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        Recipients
                        <Badge variant="secondary" className="text-xs ml-1">
                          {activeRecipients.length} / {recipients.length}
                        </Badge>
                      </CardTitle>
                      <button
                        onClick={toggleSelectAll}
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                      >
                        {excludedIds.size === 0
                          ? <><CheckSquare className="h-3.5 w-3.5" /> Deselect all</>
                          : <><Square className="h-3.5 w-3.5" /> Select all</>
                        }
                      </button>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="max-h-60 overflow-y-auto divide-y divide-border">
                      {recipients.map((r) => {
                        const excluded = excludedIds.has(r.id);
                        return (
                          <div
                            key={r.id}
                            className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-muted/40 transition-colors ${excluded ? "opacity-40" : ""}`}
                            onClick={() => toggleExclude(r.id)}
                          >
                            <Checkbox
                              checked={!excluded}
                              onCheckedChange={() => toggleExclude(r.id)}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-foreground truncate">{r.name}</p>
                              <p className="text-xs text-muted-foreground truncate">{r.email}</p>
                            </div>
                            <Badge
                              variant="outline"
                              className={`text-[10px] flex-shrink-0 ${r.status === "registered" ? "text-green-500 border-green-500/30" : "text-amber-500 border-amber-500/30"}`}
                            >
                              {r.status}
                            </Badge>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Right: Compose */}
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-muted-foreground" />
                    Compose Message
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">

                  {/* Subject */}
                  <div>
                    <Label htmlFor="msg-subject" className="text-xs text-muted-foreground mb-1.5 block">Subject</Label>
                    <Input
                      id="msg-subject"
                      placeholder="e.g. Schedule change this Friday"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                    />
                  </div>

                  {/* Body */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <Label htmlFor="msg-body" className="text-xs text-muted-foreground">Message</Label>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[11px] gap-1 text-violet-400 hover:text-violet-300"
                        onClick={handleDraftWithAI}
                        disabled={drafting}
                      >
                        {drafting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                        {drafting ? "Drafting…" : "AI draft"}
                      </Button>
                    </div>
                    <Textarea
                      id="msg-body"
                      placeholder="Write your message here, or use the AI draft button above…"
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      rows={7}
                      className="resize-none"
                    />
                    {body && (
                      <p className="text-[10px] text-muted-foreground mt-1 text-right">
                        {body.length} characters
                      </p>
                    )}
                  </div>

                  {/* Channel selector */}
                  <div>
                    <Label className="text-xs text-muted-foreground mb-2 block">Delivery channels</Label>
                    <div className="flex gap-3">
                      {[
                        { id: "in_app", label: "In-app", icon: Bell },
                        { id: "email", label: "Email", icon: Mail },
                      ].map(({ id, label, icon: Icon }) => {
                        const active = channels.includes(id);
                        return (
                          <button
                            key={id}
                            onClick={() => toggleChannel(id)}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                              active
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border text-muted-foreground hover:border-muted-foreground"
                            }`}
                          >
                            <Icon className="h-4 w-4" />
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Send summary */}
                  {activeRecipients.length > 0 && subject && body && channels.length > 0 && (
                    <div className="rounded-lg bg-muted/40 border border-border px-4 py-3 text-xs text-muted-foreground space-y-0.5">
                      <p>
                        <span className="font-semibold text-foreground">{activeRecipients.length}</span> recipient{activeRecipients.length !== 1 ? "s" : ""}
                        {" "}will receive this via{" "}
                        <span className="font-semibold text-foreground">
                          {channels.map((c) => c === "in_app" ? "in-app notification" : "email").join(" + ")}
                        </span>.
                      </p>
                    </div>
                  )}

                  {/* Send button */}
                  <Button
                    onClick={handleSend}
                    disabled={
                      sending ||
                      !subject.trim() ||
                      !body.trim() ||
                      channels.length === 0 ||
                      activeRecipients.length === 0
                    }
                    className="w-full gap-2"
                  >
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {sending
                      ? "Sending…"
                      : activeRecipients.length > 0
                        ? `Send to ${activeRecipients.length} recipient${activeRecipients.length !== 1 ? "s" : ""}`
                        : "Preview recipients first"
                    }
                  </Button>

                  {activeRecipients.length === 0 && recipients.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center">
                      Set your audience filters above and click "Preview recipients" to see who will receive this message.
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
